/**
 * Chiffrement de bout en bout de l'espace partagé. Le code d'invitation (secret aléatoire de 128 bits) ne quitte
 * jamais les téléphones : le serveur reçoit seulement son empreinte (identifiant d'espace) et des données chiffrées.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

export function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const padded = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new Error('Le partage nécessite une connexion sécurisée (https).')
  return crypto.subtle
}

export const SECRET_RE = /^[A-Za-z0-9_-]{22}$/

export function generateSecret(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
}

/** Identifiant public de l'espace : SHA-256 du secret, en hexadécimal. */
export async function spaceIdFor(secret: string): Promise<string> {
  const hash = await subtle().digest('SHA-256', enc.encode(`sillage-space-id:${secret}`))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const keys = new Map<string, Promise<CryptoKey>>()

export function keyFor(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret)
  if (!key) {
    key = (async () => {
      const base = await subtle().importKey('raw', fromBase64Url(secret), 'HKDF', false, ['deriveKey'])
      return subtle().deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('sillage-space'), info: enc.encode('notes-v1') },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
    })()
    keys.set(secret, key)
  }
  return key
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))))
  const out = new Uint8Array(iv.length + data.length)
  out.set(iv)
  out.set(data, iv.length)
  return toBase64Url(out)
}

/** Lève une erreur si le blob n'a pas été chiffré avec cette clé (mauvais code d'invitation). */
export async function decryptJson<T>(key: CryptoKey, blob: string): Promise<T> {
  const bytes = fromBase64Url(blob)
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
  return JSON.parse(dec.decode(plain)) as T
}
