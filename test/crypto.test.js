import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateDeviceKeyPair, deriveSharedKey, encrypt, decrypt, messageAad, safetyCode,
  generatePairingCode, isValidPairingCode, hashPairingCode, normalisePairingCode, generateLocalKey,
} from '../src/lib/crypto.js'

const ROOM = '11111111-1111-1111-1111-111111111111'
const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

async function pair() {
  const a = await generateDeviceKeyPair()
  const b = await generateDeviceKeyPair()
  const ka = await deriveSharedKey({ privateKey: a.privateKey, myPublicB64: a.publicKeyB64, peerPublicB64: b.publicKeyB64, roomId: ROOM })
  const kb = await deriveSharedKey({ privateKey: b.privateKey, myPublicB64: b.publicKeyB64, peerPublicB64: a.publicKeyB64, roomId: ROOM })
  return { a, b, ka, kb }
}

test('private keys are non-extractable and public key is 65 raw bytes', async () => {
  const { privateKey, publicKeyB64 } = await generateDeviceKeyPair()
  assert.equal(privateKey.extractable, false)
  await assert.rejects(() => crypto.subtle.exportKey('pkcs8', privateKey))
  assert.equal(Buffer.from(publicKeyB64, 'base64').length, 65)
  assert.equal(publicKeyB64.length, 88)
})

test('derived keys are non-extractable AES-256-GCM', async () => {
  const { ka } = await pair()
  assert.equal(ka.extractable, false)
  assert.equal(ka.algorithm.name, 'AES-GCM')
  assert.equal(ka.algorithm.length, 256)
})

test('both sides round-trip a message, including unicode', async () => {
  const { ka, kb } = await pair()
  const aad = messageAad(ROOM, ALICE, 'm1')
  const text = 'hello 💜 Kigali — ikaze'
  const { ciphertext, nonce } = await encrypt(ka, text, aad)
  assert.equal(await decrypt(kb, ciphertext, nonce, aad), text)
})

test('ciphertext does not contain plaintext; nonces are 12 bytes and never repeat', async () => {
  const { ka } = await pair()
  const aad = messageAad(ROOM, ALICE, 'm1')
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const { ciphertext, nonce } = await encrypt(ka, 'same text', aad)
    assert.equal(Buffer.from(nonce, 'base64').length, 12)
    assert.ok(!Buffer.from(ciphertext, 'base64').toString('latin1').includes('same text'))
    seen.add(nonce)
  }
  assert.equal(seen.size, 200)
})

test('tampering with ciphertext or nonce is detected', async () => {
  const { ka, kb } = await pair()
  const aad = messageAad(ROOM, ALICE, 'm1')
  const { ciphertext, nonce } = await encrypt(ka, 'secret', aad)
  const ct = Buffer.from(ciphertext, 'base64'); ct[0] ^= 1
  await assert.rejects(() => decrypt(kb, ct.toString('base64'), nonce, aad))
  const n = Buffer.from(nonce, 'base64'); n[0] ^= 1
  await assert.rejects(() => decrypt(kb, ciphertext, n.toString('base64'), aad))
  await assert.rejects(() => decrypt(kb, ciphertext, Buffer.alloc(8).toString('base64'), aad))
})

test('AAD binds room, sender and message id (server cannot move ciphertexts)', async () => {
  const { ka, kb } = await pair()
  const { ciphertext, nonce } = await encrypt(ka, 'secret', messageAad(ROOM, ALICE, 'm1'))
  await assert.rejects(() => decrypt(kb, ciphertext, nonce, messageAad(ROOM, ALICE, 'm2')))
  await assert.rejects(() => decrypt(kb, ciphertext, nonce, messageAad(ROOM, 'someone-else', 'm1')))
  await assert.rejects(() => decrypt(kb, ciphertext, nonce, messageAad('other-room', ALICE, 'm1')))
})

test('a third party (or wrong room) cannot decrypt', async () => {
  const { a, b, ka } = await pair()
  const eve = await generateDeviceKeyPair()
  const aad = messageAad(ROOM, ALICE, 'm1')
  const { ciphertext, nonce } = await encrypt(ka, 'secret', aad)
  const ke = await deriveSharedKey({ privateKey: eve.privateKey, myPublicB64: eve.publicKeyB64, peerPublicB64: a.publicKeyB64, roomId: ROOM })
  await assert.rejects(() => decrypt(ke, ciphertext, nonce, aad))
  const wrongRoom = await deriveSharedKey({ privateKey: b.privateKey, myPublicB64: b.publicKeyB64, peerPublicB64: a.publicKeyB64, roomId: 'other' })
  await assert.rejects(() => decrypt(wrongRoom, ciphertext, nonce, aad))
})

test('invalid peer keys are rejected', async () => {
  const a = await generateDeviceKeyPair()
  const junk = Buffer.alloc(65, 7).toString('base64')
  await assert.rejects(() => deriveSharedKey({ privateKey: a.privateKey, myPublicB64: a.publicKeyB64, peerPublicB64: junk, roomId: ROOM }))
  await assert.rejects(() => deriveSharedKey({ privateKey: a.privateKey, myPublicB64: a.publicKeyB64, peerPublicB64: a.publicKeyB64, roomId: ROOM }))
})

test('safety code: identical for both people, different if a key is swapped', async () => {
  const a = await generateDeviceKeyPair(), b = await generateDeviceKeyPair(), mitm = await generateDeviceKeyPair()
  const s1 = await safetyCode({ roomId: ROOM, keyA: a.publicKeyB64, keyB: b.publicKeyB64 })
  const s2 = await safetyCode({ roomId: ROOM, keyA: b.publicKeyB64, keyB: a.publicKeyB64 })
  assert.deepEqual(s1, s2)
  assert.match(s1.digits, /^\d{5}( \d{5}){5}$/)
  assert.equal(s1.emoji.split(' ').length, 8)
  const swapped = await safetyCode({ roomId: ROOM, keyA: a.publicKeyB64, keyB: mitm.publicKeyB64 })
  assert.notEqual(s1.digits, swapped.digits)
})

test('pairing code: format, normalisation, hashing', async () => {
  const code = generatePairingCode()
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.ok(isValidPairingCode(code))
  assert.ok(isValidPairingCode(code.toLowerCase().replace(/-/g, ' ')))
  assert.ok(!isValidPairingCode('ABCD-EFGH-IJK0'))
  assert.equal(normalisePairingCode(' ab-cd '), 'ABCD')
  const h = await hashPairingCode(code)
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(h, await hashPairingCode(code.toLowerCase()))
  assert.ok(!h.includes(normalisePairingCode(code)))
  assert.notEqual(generatePairingCode(), generatePairingCode())
})

test('local history key is non-extractable and round-trips', async () => {
  const k = await generateLocalKey()
  assert.equal(k.extractable, false)
  const { ciphertext, nonce } = await encrypt(k, 'local', messageAad('x', 'y', 'z'))
  assert.equal(await decrypt(k, ciphertext, nonce, messageAad('x', 'y', 'z')), 'local')
})
