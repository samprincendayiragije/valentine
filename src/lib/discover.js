// Pure helpers for the Discover feed (no browser APIs, so they are unit-tested in Node).
// Discover uses YouTube's official search API. Facebook has no search API, so it is not part of this.

export const API_HOST = 'https://www.googleapis.com'
export const IMG_HOST = 'https://i.ytimg.com'

// What each tag searches for, in rotation. Suggestive, not explicit; nothing here can be guaranteed (see SECURITY.md).
export const QUERIES = {
  Kissing: ['romantic couple kiss', 'kissing sounds ASMR', 'passionate kiss movie scene'],
  Romantic: ['romantic couple moments', 'romantic slow dance couple', 'date night couple vlog'],
  Flirty: ['flirty couple', 'couple teasing each other', 'flirty banter couple'],
  ASMR: ['couple ASMR whisper', 'romantic ASMR roleplay', 'boyfriend ASMR', 'girlfriend ASMR'],
  Spicy: ['sensual slow dance couple', 'steamy romance scene', 'sultry couple dance'],
}

// Words that must not appear in results. Best effort: a search can still return things we would not want.
const EXCLUDE = '-kids -kid -child -children -teen -teens -school -baby -minor'

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const TOKEN = /^[A-Za-z0-9_-]{1,100}$/

export function buildUrl({ q, pageToken, key }) {
  const u = new URL(`${API_HOST}/youtube/v3/search`)
  u.searchParams.set('part', 'snippet')
  u.searchParams.set('type', 'video')
  u.searchParams.set('videoEmbeddable', 'true')      // age-restricted videos cannot be embedded, which also filters the most explicit ones
  u.searchParams.set('videoSyndicated', 'true')
  u.searchParams.set('videoDuration', 'short')
  u.searchParams.set('safeSearch', 'moderate')
  u.searchParams.set('maxResults', '12')
  u.searchParams.set('q', `${q} ${EXCLUDE}`)
  if (pageToken && TOKEN.test(pageToken)) u.searchParams.set('pageToken', pageToken)
  u.searchParams.set('key', key)
  return u.href
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }
export const decodeEntities = (s) => String(s ?? '')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isInteger(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : m
    }
    return ENT[e.toLowerCase()] ?? m
  })
  .slice(0, 200)

export function parseResults(json) {
  const items = []
  for (const it of json?.items ?? []) {
    const id = it?.id?.videoId
    if (typeof id === 'string' && YT_ID.test(id)) {
      items.push({ id, title: decodeEntities(it.snippet?.title), channel: decodeEntities(it.snippet?.channelTitle) })
    }
  }
  const next = typeof json?.nextPageToken === 'string' && TOKEN.test(json.nextPageToken) ? json.nextPageToken : undefined
  return { items, next }
}

export const thumbUrl = (id) => `${IMG_HOST}/vi/${id}/hqdefault.jpg`
