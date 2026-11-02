// Pure game logic (no browser APIs) so it can be unit-tested in Node.
// Decks and game moves travel between the two phones as ordinary end-to-end encrypted messages.

export const TO = ['drawer', 'other', 'both']
export const LIMITS = { cards: 40, card: 200, title: 40, deckBytes: 9000 }
const ID = /^[A-Za-z0-9-]{1,40}$/

function text(v, max) {
  if (typeof v !== 'string') throw new Error('bad text')
  const s = v.trim()
  if (!s || s.length > max) throw new Error('bad length')
  return s
}

// Validates and normalises a deck, whether made on this phone or received from the other one.
export function cleanDeck(d) {
  if (!d || typeof d !== 'object') throw new Error('bad deck')
  if (typeof d.id !== 'string' || !ID.test(d.id)) throw new Error('bad deck id')
  if (!Array.isArray(d.cards) || d.cards.length < 1 || d.cards.length > LIMITS.cards) throw new Error('bad card count')
  const deck = {
    id: d.id,
    title: text(d.title, LIMITS.title),
    cards: d.cards.map((c) => ({ t: text(c?.t, LIMITS.card), to: TO.includes(c?.to) ? c.to : 'drawer' })),
  }
  if (new TextEncoder().encode(JSON.stringify(deck)).length > LIMITS.deckBytes) throw new Error('Deck too large')
  return deck
}

const OPS = ['start', 'draw', 'done', 'pass', 'end']

export function cleanPlay(p) {
  if (!p || !OPS.includes(p.op) || typeof p.gid !== 'string' || !ID.test(p.gid)) throw new Error('bad move')
  if (p.op === 'start') return { op: 'start', gid: p.gid, deck: cleanDeck(p.deck) }
  if (p.op === 'end') return { op: 'end', gid: p.gid }
  if (!Number.isInteger(p.idx) || p.idx < 0 || p.idx >= LIMITS.cards) throw new Error('bad card index')
  return { op: p.op, gid: p.gid, idx: p.idx }
}

// Rebuilds the current game from the move messages. Invalid or out-of-turn moves are ignored,
// so a confused or hostile client cannot put the game into an impossible state.
// plays: [{ from: 'me'|'peer', ts, id, play }]
export function deriveSession(plays) {
  const sorted = plays.slice().sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1))
  let s = null
  for (const m of sorted) {
    const p = m.play
    if (!p) continue
    if (p.op === 'start') {
      s = { gid: p.gid, deck: p.deck, used: [], current: null, turn: m.from, startedBy: m.from, done: 0, passed: 0 }
      continue
    }
    if (!s || p.gid !== s.gid) continue
    if (p.op === 'end') { s = null; continue }
    if (p.op === 'draw') {
      if (s.current || m.from !== s.turn || p.idx >= s.deck.cards.length || s.used.includes(p.idx)) continue
      s.used.push(p.idx)
      s.current = { idx: p.idx, by: m.from }
      continue
    }
    if (!s.current || p.idx !== s.current.idx) continue   // done / pass
    if (p.op === 'done') s.done += 1; else s.passed += 1
    s.turn = s.current.by === 'me' ? 'peer' : 'me'
    s.current = null
  }
  if (s) s.finished = !s.current && s.used.length >= s.deck.cards.length
  return s
}

// Picks a random card that has not been used yet, or null if the deck is finished.
export function drawIndex(session) {
  const left = session.deck.cards.map((_, i) => i).filter((i) => !session.used.includes(i))
  if (!left.length) return null
  const r = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
  return left[r % left.length]
}

// Who is the card for, from the point of view of the person looking at it?
export function audience(card, drawnByMe) {
  if (card.to === 'both') return 'both'
  return (card.to === 'drawer') === drawnByMe ? 'you' : 'partner'
}

// ---------- built-in decks ----------
// Romantic to suggestive. Nothing explicit: anything beyond that is for the two of you to
// write yourselves in "Create a deck". Every card can be passed, always.
const d = (t) => ({ t, to: 'drawer' })
const o = (t) => ({ t, to: 'other' })
const b = (t) => ({ t, to: 'both' })

export const BUILTIN_DECKS = [
  {
    id: 'builtin-sweet', emoji: '💗', level: 'Sweet', title: 'Warm-up',
    cards: [
      d('Tell your partner the exact moment you knew you liked them.'),
      o('Ask: what is a small thing I do that always makes you smile?'),
      b('Each share one thing you are looking forward to doing together this year.'),
      d('Send a voice note with three things you admire about them.'),
      b('Each describe our perfect lazy Sunday, hour by hour.'),
      o('Ask: which song reminds you of us, and why?'),
      d('Send a photo of something that made you think of them today.'),
      d('Tell them a memory of us that you replay in your head.'),
      b('Describe each other in exactly three words.'),
      o('Ask: what would you like a little more of from me?'),
      d('Plan a surprise date and describe it in detail, without saying where.'),
      d('Send a voice note singing one line of a love song, badly on purpose.'),
    ],
  },
  {
    id: 'builtin-flirty', emoji: '😉', level: 'Flirty', title: 'Lean in',
    cards: [
      d('Describe, in detail, what you find most attractive about your partner.'),
      d('Send a voice note in your softest, slowest voice about what you have been thinking about today.'),
      o('Ask: which outfit of mine do you like most, and what do you like about it?'),
      d('Send a photo of a look you feel great in right now.'),
      b('Each describe our most memorable kiss.'),
      d('Tell your partner what you would love them to wear on our next date night.'),
      o('Ask: what is the most romantic thing I could do for you tonight?'),
      d('Send a short video of you blowing a kiss.'),
      d('Describe our ideal slow dance: the song, the room, how close we stand.'),
      o('Ask: which compliment do you secretly want to hear more often?'),
      b('Each tell the story of when you first felt butterflies around the other.'),
      d('You have 60 seconds: compliment your partner non-stop, voice note or text.'),
    ],
  },
  {
    id: 'builtin-spicy', emoji: '🔥', level: 'Spicy', title: 'After dark',
    cards: [
      d('Send a voice note whispering one thing you want us to do the next time we are alone.'),
      o('Ask: where do you love being kissed most?'),
      d('Set the scene: describe how you would arrange a perfect night in. Lights, music, mood.'),
      d('Send a photo of a look you feel hot in. Your comfort level, your call.'),
      o('Ask: what is one thing you are curious to try together? Share only what you want to.'),
      b('Each describe the moment you were most attracted to the other.'),
      d('Send a voice note about what you would do if we had a whole evening to ourselves. Tease, no spoilers.'),
      o('Ask: what is something I do that drives you wild?'),
      d('Write a four-line flirty poem about your partner and send it as a voice note.'),
      b('Each write a yes / maybe / no list of three date-night ideas, then compare.'),
      d('Describe for two minutes what you would want to feel, hear and smell on a perfect night together.'),
      o('Ask: what is your favourite way for me to tease you?'),
    ],
  },
]
