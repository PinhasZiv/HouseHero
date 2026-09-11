// Generates the VAPID key pair that identifies this app to push services.
//
// Run once: `npm run vapid`. The public key goes into the browser bundle, the
// private key stays a server secret. Regenerating them invalidates every
// existing subscription, so keep the output somewhere safe.

import { webcrypto } from 'node:crypto'

const toBase64Url = (buffer) => Buffer.from(buffer).toString('base64url')

const pair = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)

const publicKey = toBase64Url(await webcrypto.subtle.exportKey('raw', pair.publicKey))
const { d: privateKey } = await webcrypto.subtle.exportKey('jwk', pair.privateKey)

console.log(`
VAPID keys generated.

  Public key  (safe to publish - goes in the app bundle)
  ${publicKey}

  Private key (secret - only the setup SQL and Supabase see this)
  ${privateKey}

Next:
  1. src/config.ts -> VAPID_PUBLIC_KEY = the public key above
  2. supabase/migrations/0001_init.sql -> PASTE_VAPID_PRIVATE_KEY_HERE (or the
     VAPID_PRIVATE_KEY repository secret, if using the migration workflow)
       = the private key above
`)
