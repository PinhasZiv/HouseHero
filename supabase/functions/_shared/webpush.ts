// Web Push (RFC 8291 encryption + RFC 8292 VAPID) on nothing but Web Crypto.
//
// The usual `web-push` npm package assumes Node's crypto and https modules,
// which is a poor fit for the Deno edge runtime. The protocol is small enough
// to implement directly, and doing so removes a whole class of "works locally,
// fails on deploy" problems.

export interface PushTarget {
  endpoint: string
  /** Client public key, base64url, 65-byte uncompressed P-256 point. */
  p256dh: string
  /** Client auth secret, base64url, 16 bytes. */
  auth: string
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point. */
  publicKey: string
  /** base64url, 32-byte P-256 private scalar. */
  privateKey: string
  /** Contact URI, e.g. `mailto:you@example.com`. */
  subject: string
}

export type PushResult =
  | { ok: true; status: number }
  | { ok: false; status: number; gone: boolean; detail: string }

const encoder = new TextEncoder()

/**
 * Byte arrays backed by a plain ArrayBuffer. Web Crypto's `BufferSource` will
 * not accept a view that might sit on a SharedArrayBuffer, so the whole module
 * is explicit about which kind it is passing around.
 */
type Bytes = Uint8Array<ArrayBuffer>

export function base64UrlDecode(value: string): Bytes {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export function base64UrlEncode(bytes: Bytes | Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...chunks: Bytes[]): Bytes {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** An info string as HKDF expects it: UTF-8, null terminated. */
function info(label: string): Bytes {
  return concat(encoder.encode(label), new Uint8Array([0]))
}

async function hkdf(
  salt: Bytes,
  ikm: Bytes,
  infoBytes: Bytes,
  lengthBytes: number,
): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: infoBytes },
    key,
    lengthBytes * 8,
  )
  return new Uint8Array(bits)
}

/**
 * The VAPID `Authorization` header. Signed per push-service origin and valid
 * for 12 hours, so it is cheap to cache across a batch of sends.
 */
async function vapidHeader(endpoint: string, keys: VapidKeys): Promise<string> {
  const publicKey = base64UrlDecode(keys.publicKey)
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point')
  }

  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(publicKey.slice(1, 33)),
    y: base64UrlEncode(publicKey.slice(33, 65)),
    d: base64UrlEncode(base64UrlDecode(keys.privateKey)),
    ext: true,
  }

  const signingKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  )

  const signingInput = `${header}.${claims}`
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      signingKey,
      encoder.encode(signingInput),
    ),
  )

  return `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${keys.publicKey}`
}

/** Encrypts a payload into a single `aes128gcm` record for one subscriber. */
async function encryptPayload(target: PushTarget, payload: string): Promise<Bytes> {
  const clientPublic = base64UrlDecode(target.p256dh)
  const authSecret = base64UrlDecode(target.auth)

  const ephemeral = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))

  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, ephemeral.privateKey, 256),
  )

  // RFC 8291 §3.3: the auth secret salts the shared secret, and both public
  // keys are bound into the info so a key swap invalidates the derivation.
  const keyInfo = concat(info('WebPush: info'), clientPublic, serverPublic)
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const contentKey = await hkdf(salt, ikm, info('Content-Encoding: aes128gcm'), 16)
  const nonce = await hkdf(salt, ikm, info('Content-Encoding: nonce'), 12)

  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt'])
  // 0x02 is the "this is the last record" delimiter.
  const record = concat(encoder.encode(payload), new Uint8Array([2]))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record),
  )

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, 4096, false)

  // salt | record size | key id length | key id | ciphertext
  return concat(salt, recordSize, new Uint8Array([serverPublic.length]), serverPublic, ciphertext)
}

export async function sendPush(
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  ttlSeconds = 12 * 60 * 60,
): Promise<PushResult> {
  try {
    const body = await encryptPayload(target, JSON.stringify(payload))
    const response = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(target.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttlSeconds),
        Urgency: 'normal',
      },
      body,
    })

    if (response.ok) return { ok: true, status: response.status }

    // 404/410 mean the browser threw the subscription away - uninstalled app,
    // cleared site data, permission revoked. The row should go with it.
    return {
      ok: false,
      status: response.status,
      gone: response.status === 404 || response.status === 410,
      detail: (await response.text().catch(() => '')).slice(0, 200),
    }
  } catch (error) {
    return { ok: false, status: 0, gone: false, detail: String(error).slice(0, 200) }
  }
}
