// What goes inside an encrypted message. The server only ever sees the ciphertext of this.
// Everything received from the other phone is validated here before the app uses it.
import { cleanDeck, cleanPlay } from './games.js'
import { cleanWatch } from './embed.js'

export const MAX_LEN = 2000
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024
export const MAX_AUDIO_SECS = 180

export const MIME = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'],
}

export const baseMime = (t) => String(t ?? '').split(';')[0].trim().toLowerCase()

export function encodePayload(msg) {
  switch (msg.kind) {
    case 'media': return { k: 'media', ts: msg.ts, t: msg.text || '', m: msg.media }
    case 'deck': return { k: 'deck', ts: msg.ts, d: msg.deck }
    case 'play': return { k: 'play', ts: msg.ts, p: msg.play }
    case 'watch': return { k: 'watch', ts: msg.ts, w: { url: msg.watch.url, tag: msg.watch.tag } }
    default: return { t: msg.text, ts: msg.ts }
  }
}

// Returns the message fields (kind, text/media/deck/play, ts) or throws if the content is not valid.
export function decodePayload(p, fallbackTs) {
  const ts = Math.min(Number(p?.ts) || fallbackTs, Date.now() + 60000)
  if (p?.k === undefined) return { kind: 'text', ts, text: String(p.t).slice(0, MAX_LEN) }
  if (p.k === 'media') {
    const m = p.m
    const mime = baseMime(m?.mime)
    if (!m || !MIME[m.kind]?.includes(mime)) throw new Error('unsupported media')
    if (!Number.isInteger(m.size) || m.size < 1 || m.size > MAX_MEDIA_BYTES) throw new Error('bad media size')
    const dur = Number.isFinite(m.dur) ? Math.min(Math.max(0, Math.round(m.dur)), 24 * 3600) : 0
    return { kind: 'media', ts, text: String(p.t ?? '').slice(0, MAX_LEN), media: { kind: m.kind, mime, size: m.size, dur } }
  }
  if (p.k === 'deck') return { kind: 'deck', ts, deck: cleanDeck(p.d) }
  if (p.k === 'play') return { kind: 'play', ts, play: cleanPlay(p.p) }
  if (p.k === 'watch') return { kind: 'watch', ts, watch: cleanWatch(p.w) }
  return { kind: 'unsupported', ts }
}
