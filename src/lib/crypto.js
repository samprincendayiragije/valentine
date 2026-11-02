// All cryptography here is the browser's built-in Web Crypto API (crypto.subtle).
// There is no hand-written crypto and no crypto library. This file only wires the
// standard primitives together:
//   ECDH P-256  ->  HKDF-SHA-256  ->  AES-256-GCM (fresh random 96-bit nonce per message)

const subtle = globalThis.crypto.subtle
const enc = new TextEncoder()
const dec = new TextDecoder()

const PROTOCOL = 'valentine-v1'
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }

// ---------- encoding helpers ----------
export function toB64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export function fromB64(str) {
  const s = atob(str)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

// ---------- device identity ----------
// The private key is generated NON-extractable: the browser will never hand its
// bytes to JavaScript, so it can only be used on this device. The public key is
// always exportable (raw 65-byte uncompressed point, base64 = 88 chars).
export async function generateDeviceKeyPair() {
  const pair = await subtle.generateKey(ECDH, false, ['deriveBits'])
  const rawPublic = await subtle.exportKey('raw', pair.publicKey)
  return { privateKey: pair.privateKey, publicKeyB64: toB64(rawPublic) }
}

// Separate non-extractable key used only to encrypt this device's local history.
export function generateLocalKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// ---------- shared message key ----------
export async function deriveSharedKey({ privateKey, myPublicB64, peerPublicB64, roomId }) {
  if (myPublicB64 === peerPublicB64) throw new Error('Peer key equals own key')
  // importKey validates that the bytes are a real point on the P-256 curve.
  const peerKey = await subtle.importKey('raw', fromB64(peerPublicB64), ECDH, false, [])
  const secret = await subtle.deriveBits({ name: 'ECDH', public: peerKey }, privateKey, 256)
  const hkdfBase = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey'])
  const [a, b] = [myPublicB64, peerPublicB64].sort() // both sides derive identical info
  const salt = await subtle.digest('SHA-256', enc.encode(`${PROTOCOL}|room|${roomId}`))
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`${PROTOCOL}|msg|${a}|${b}`) },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---------- AES-256-GCM ----------
// `aad` is authenticated but not encrypted. Binding room, sender and message id means
// the server cannot move a ciphertext to another room, sender or id undetected.
export const messageAad = (roomId, senderId, messageId) =>
  enc.encode(`${PROTOCOL}|aad|${roomId}|${senderId}|${messageId}`)

export async function encrypt(key, plaintext, aad) {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12)) // fresh every call
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
    key,
    enc.encode(plaintext),
  )
  return { ciphertext: toB64(ct), nonce: toB64(nonce) }
}

export async function decrypt(key, ciphertextB64, nonceB64, aad) {
  const nonce = fromB64(nonceB64)
  if (nonce.length !== 12) throw new Error('Bad nonce length')
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
    key,
    fromB64(ciphertextB64),
  )
  return dec.decode(pt)
}

// ---------- safety code ----------
// Both people see the same value iff they hold each other's real public keys.
// If a server (or anyone) swapped a key during pairing, the codes will differ.
const EMOJI = [
  '🐶','🐱','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦉',
  '🦋','🐢','🐙','🐬','🐳','🦈','🐝','🐞','🌵','🌲','🌴','🍀','🍄','🌻','🌹','🌙',
  '⭐','☀️','🌈','🔥','💧','❄️','🍎','🍋','🍌','🍉','🍇','🍓','🍒','🥑','🌽','🥕',
  '🍕','🍔','🍩','🍪','☕','🎈','🎁','🎵','⚽','🚲','🚀','⛵','🔑','🔔','📚','💡',
]

export async function safetyCode({ roomId, keyA, keyB }) {
  const [a, b] = [keyA, keyB].sort()
  const h = new Uint8Array(await subtle.digest('SHA-256', enc.encode(`${PROTOCOL}|safety|${roomId}|${a}|${b}`)))
  const view = new DataView(h.buffer)
  const groups = []
  for (let i = 0; i < 6; i++) groups.push(String(view.getUint32(i * 4) % 100000).padStart(5, '0'))
  const emoji = []
  for (let i = 24; i < 32; i++) emoji.push(EMOJI[h[i] % 64]) // 256 % 64 === 0, no bias
  return { digits: groups.join(' '), emoji: emoji.join(' ') }
}

// ---------- pairing code ----------
// 12 chars from a 32-symbol alphabet = 60 bits, from crypto.getRandomValues.
// The server only ever receives the SHA-256 of the normalised code, never the code.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

export function generatePairingCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const raw = [...bytes].map((b) => ALPHABET[b % 32]).join('') // 256 % 32 === 0, no bias
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

export function normalisePairingCode(input) {
  return String(input).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export const isValidPairingCode = (input) => {
  const c = normalisePairingCode(input)
  return c.length === 12 && [...c].every((ch) => ALPHABET.includes(ch))
}

export async function hashPairingCode(input) {
  const digest = await subtle.digest('SHA-256', enc.encode(`${PROTOCOL}|code|${normalisePairingCode(input)}`))
  return toHex(digest)
}

// ---------- files (photos, videos, voice notes) ----------
// A file is encrypted as one AES-GCM blob stored as: 12-byte nonce || ciphertext+tag.
// The AAD binds it to this room, sender and message id, like text messages.
export const mediaAad = (roomId, senderId, mediaId) => enc.encode(`${PROTOCOL}|media|${roomId}|${senderId}|${mediaId}`)

export async function encryptBytes(key, bytes, aad) {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, bytes))
  const out = new Uint8Array(12 + ct.length)
  out.set(nonce, 0)
  out.set(ct, 12)
  return out
}

export async function decryptBytes(key, data, aad) {
  if (data.length < 12 + 16) throw new Error('Too short')
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: data.slice(0, 12), additionalData: aad, tagLength: 128 }, key, data.slice(12))
  return new Uint8Array(pt)
}
