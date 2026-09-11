import { describe, expect, it, vi } from 'vitest'
import { base64UrlDecode, base64UrlEncode, sendPush } from '../../supabase/functions/_shared/webpush.ts'

// These tests play the part of the browser on the receiving end: they take the
// bytes `sendPush` puts on the wire and decrypt them the way a push service and
// a service worker would. If the encryption is wrong, the payload comes out as
// garbage here instead of as a silently missing notification on a phone.

/** Same constraint as the module under test: no SharedArrayBuffer views. */
type Bytes = Uint8Array<ArrayBuffer>

/** Copies a view into a fresh ArrayBuffer so Web Crypto will accept it. */
function own(view: Uint8Array): Bytes {
  return new Uint8Array(view)
}

async function generateP256(usages: KeyUsage[], algorithm: 'ECDH' | 'ECDSA') {
  return (await crypto.subtle.generateKey({ name: algorithm, namedCurve: 'P-256' }, true, usages)) as CryptoKeyPair
}

async function makeVapidKeys() {
  const pair = await generateP256(['sign', 'verify'], 'ECDSA')
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return {
    publicKey: base64UrlEncode(raw),
    privateKey: jwk.d as string,
    subject: 'mailto:househero@example.com',
  }
}

async function makeSubscriber() {
  const pair = await generateP256(['deriveBits'], 'ECDH')
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const authSecret = crypto.getRandomValues(new Uint8Array(16))
  return {
    privateKey: pair.privateKey,
    publicKey,
    target: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      p256dh: base64UrlEncode(publicKey),
      auth: base64UrlEncode(authSecret),
    },
  }
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

function join(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const label = (text: string) => join(new TextEncoder().encode(text), new Uint8Array([0]))

/** The subscriber side of RFC 8291. */
async function decryptAes128Gcm(body: Bytes, subscriber: Awaited<ReturnType<typeof makeSubscriber>>) {
  const salt = own(body.slice(0, 16))
  const keyIdLength = body[20]
  const serverPublic = own(body.slice(21, 21 + keyIdLength))
  const ciphertext = own(body.slice(21 + keyIdLength))

  const serverKey = await crypto.subtle.importKey('raw', serverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, subscriber.privateKey, 256))

  const ikm = await hkdf(
    base64UrlDecode(subscriber.target.auth),
    shared,
    join(label('WebPush: info'), own(subscriber.publicKey), serverPublic),
    32,
  )
  const contentKey = await hkdf(salt, ikm, label('Content-Encoding: aes128gcm'), 16)
  const nonce = await hkdf(salt, ikm, label('Content-Encoding: nonce'), 12)

  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['decrypt'])
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext))

  expect(plaintext[plaintext.length - 1]).toBe(2) // last-record delimiter
  return new TextDecoder().decode(plaintext.slice(0, -1))
}

describe('web push', () => {
  it('produces a payload the subscriber can actually decrypt', async () => {
    const keys = await makeVapidKeys()
    const subscriber = await makeSubscriber()
    const message = { title: 'Time for a task', tasks: ['Dishes', 'Laundry'], spaceId: 'abc' }

    let sentBody: Bytes | undefined
    let sentHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sentBody = new Uint8Array(init.body as ArrayBuffer)
      sentHeaders = init.headers as Record<string, string>
      return new Response(null, { status: 201 })
    })

    const result = await sendPush(subscriber.target, message, keys)
    expect(result.ok).toBe(true)

    expect(sentHeaders['Content-Encoding']).toBe('aes128gcm')
    expect(sentHeaders.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/)

    expect(JSON.parse(await decryptAes128Gcm(sentBody!, subscriber))).toEqual(message)
    vi.unstubAllGlobals()
  })

  it('signs a VAPID token scoped to the push service origin', async () => {
    const keys = await makeVapidKeys()
    const subscriber = await makeSubscriber()

    let auth = ''
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization
      return new Response(null, { status: 201 })
    })
    await sendPush(subscriber.target, { hello: 'world' }, keys)

    const token = auth.slice('vapid t='.length).split(',')[0]
    const [, claims] = token.split('.')
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(claims)))
    expect(parsed.aud).toBe('https://fcm.googleapis.com')
    expect(parsed.sub).toBe('mailto:househero@example.com')
    expect(parsed.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    vi.unstubAllGlobals()
  })

  it('flags a dropped subscription as gone so the row can be deleted', async () => {
    const keys = await makeVapidKeys()
    const subscriber = await makeSubscriber()
    vi.stubGlobal('fetch', async () => new Response('unsubscribed', { status: 410 }))

    const result = await sendPush(subscriber.target, { a: 1 }, keys)
    expect(result).toMatchObject({ ok: false, status: 410, gone: true })
    vi.unstubAllGlobals()
  })

  it('reports a network failure instead of throwing', async () => {
    const keys = await makeVapidKeys()
    const subscriber = await makeSubscriber()
    vi.stubGlobal('fetch', async () => {
      throw new Error('connection reset')
    })

    const result = await sendPush(subscriber.target, { a: 1 }, keys)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toContain('connection reset')
    vi.unstubAllGlobals()
  })

  it('round-trips base64url without padding', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(65))
    const encoded = base64UrlEncode(bytes)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(base64UrlDecode(encoded)).toEqual(bytes)
  })
})
