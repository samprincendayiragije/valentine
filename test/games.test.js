import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_DECKS, cleanDeck, cleanPlay, deriveSession, drawIndex, audience, LIMITS } from '../src/lib/games.js'
import { encodePayload, decodePayload } from '../src/lib/wire.js'
import { generateDeviceKeyPair, deriveSharedKey, encryptBytes, decryptBytes, mediaAad } from '../src/lib/crypto.js'

const deck = { id: 'd1', title: 'T', cards: [{ t: 'a', to: 'drawer' }, { t: 'b', to: 'other' }, { t: 'c', to: 'both' }] }
let n = 0
const mv = (from, play) => ({ id: String(++n).padStart(4, '0'), from, ts: n, play })

test('every built-in deck is valid and small enough to send', () => {
  for (const d of BUILTIN_DECKS) assert.doesNotThrow(() => cleanDeck(d), d.id)
})

test('cleanDeck rejects bad input and normalises odd values', () => {
  assert.throws(() => cleanDeck(null))
  assert.throws(() => cleanDeck({ ...deck, id: 'has space' }))
  assert.throws(() => cleanDeck({ ...deck, cards: [] }))
  assert.throws(() => cleanDeck({ ...deck, title: '  ' }))
  assert.throws(() => cleanDeck({ ...deck, cards: Array(LIMITS.cards + 1).fill({ t: 'x' }) }))
  assert.throws(() => cleanDeck({ ...deck, cards: [{ t: 'x'.repeat(LIMITS.card + 1) }] }))
  assert.equal(cleanDeck({ ...deck, cards: [{ t: ' hi ', to: 'nonsense' }] }).cards[0].to, 'drawer')
})

test('a full-size deck of emoji is rejected before it can exceed the message limit', () => {
  const big = { id: 'big', title: 'Big', cards: Array(LIMITS.cards).fill({ t: '😀'.repeat(100), to: 'both' }) }
  assert.throws(() => cleanDeck(big), /too large/)
})

test('cleanPlay validates moves', () => {
  assert.throws(() => cleanPlay({ op: 'nuke', gid: 'g' }))
  assert.throws(() => cleanPlay({ op: 'draw', gid: 'g', idx: -1 }))
  assert.throws(() => cleanPlay({ op: 'draw', gid: 'g', idx: 1.5 }))
  assert.deepEqual(cleanPlay({ op: 'draw', gid: 'g', idx: 2, extra: 1 }), { op: 'draw', gid: 'g', idx: 2 })
})

test('turns alternate and out-of-turn or repeated moves are ignored', () => {
  const plays = [
    mv('me', { op: 'start', gid: 'g', deck }),
    mv('peer', { op: 'draw', gid: 'g', idx: 0 }),          // not their turn: ignored
    mv('me', { op: 'draw', gid: 'g', idx: 1 }),
    mv('me', { op: 'draw', gid: 'g', idx: 2 }),            // card still open: ignored
    mv('peer', { op: 'pass', gid: 'g', idx: 1 }),
    mv('peer', { op: 'draw', gid: 'g', idx: 1 }),          // already used: ignored
    mv('peer', { op: 'draw', gid: 'g', idx: 2 }),
    mv('me', { op: 'done', gid: 'g', idx: 2 }),
  ]
  const s = deriveSession(plays)
  assert.deepEqual(s.used, [1, 2])
  assert.equal(s.passed, 1)
  assert.equal(s.done, 1)
  assert.equal(s.turn, 'me')
  assert.equal(s.current, null)
})

test('the deck finishes and ending a game clears it', () => {
  const plays = [mv('me', { op: 'start', gid: 'g', deck: { ...deck, cards: [deck.cards[0]] } }), mv('me', { op: 'draw', gid: 'g', idx: 0 }), mv('peer', { op: 'done', gid: 'g', idx: 0 })]
  assert.equal(deriveSession(plays).finished, true)
  assert.equal(deriveSession([...plays, mv('me', { op: 'end', gid: 'g' })]), null)
  assert.equal(deriveSession([mv('me', { op: 'draw', gid: 'g', idx: 0 })]), null)
})

test('drawIndex only returns unused cards', () => {
  const s = { deck, used: [0, 2] }
  for (let i = 0; i < 20; i++) assert.equal(drawIndex(s), 1)
  assert.equal(drawIndex({ deck, used: [0, 1, 2] }), null)
})

test('audience is described from the viewer\'s side', () => {
  assert.equal(audience({ to: 'drawer' }, true), 'you')
  assert.equal(audience({ to: 'drawer' }, false), 'partner')
  assert.equal(audience({ to: 'other' }, true), 'partner')
  assert.equal(audience({ to: 'other' }, false), 'you')
  assert.equal(audience({ to: 'both' }, true), 'both')
})

test('payloads round-trip and hostile media metadata is refused', () => {
  const media = { kind: 'audio', mime: 'audio/webm', size: 1000, dur: 12 }
  const out = decodePayload(JSON.parse(JSON.stringify(encodePayload({ kind: 'media', ts: 5, text: 'hi', media }))), 1)
  assert.equal(out.kind, 'media'); assert.equal(out.media.mime, 'audio/webm')
  assert.equal(decodePayload({ t: 'plain', ts: 5 }, 1).kind, 'text')
  assert.throws(() => decodePayload({ k: 'media', ts: 1, m: { ...media, mime: 'text/html' } }, 1))
  assert.throws(() => decodePayload({ k: 'media', ts: 1, m: { ...media, kind: 'image' } }, 1))   // mime does not match kind
  assert.throws(() => decodePayload({ k: 'media', ts: 1, m: { ...media, size: 10 ** 9 } }, 1))
  assert.equal(decodePayload({ k: 'future-thing', ts: 1 }, 1).kind, 'unsupported')
})

test('files encrypt and decrypt, and are bound to room, sender and id', async () => {
  const a = await generateDeviceKeyPair(); const b = await generateDeviceKeyPair()
  const room = '11111111-1111-1111-1111-111111111111'
  const ka = await deriveSharedKey({ privateKey: a.privateKey, myPublicB64: a.publicKeyB64, peerPublicB64: b.publicKeyB64, roomId: room })
  const kb = await deriveSharedKey({ privateKey: b.privateKey, myPublicB64: b.publicKeyB64, peerPublicB64: a.publicKeyB64, roomId: room })
  const data = new Uint8Array(5000).map((_, i) => i % 251)
  const aad = mediaAad(room, 'alice', 'm1')
  const sealed = await encryptBytes(ka, data, aad)
  assert.equal(sealed.length, 12 + 5000 + 16)
  assert.deepEqual(await decryptBytes(kb, sealed, aad), data)
  await assert.rejects(() => decryptBytes(kb, sealed, mediaAad(room, 'alice', 'm2')))
  const bad = sealed.slice(); bad[100] ^= 1
  await assert.rejects(() => decryptBytes(kb, bad, aad))
  await assert.rejects(() => decryptBytes(kb, new Uint8Array(10), aad))
})
