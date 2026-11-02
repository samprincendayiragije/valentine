// Turns a pasted link into something safe to play. Pure (no browser APIs) so it is unit-tested.
// Only the sources named here can ever load inside the app: index.html's Content-Security-Policy lists the same
// hosts, and test/embed.test.js fails if the two ever drift apart.

// Where embedded players are loaded from (CSP frame-src).
export const FRAME_HOSTS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.facebook.com']

// Sites a plain .mp4/.webm link may come from (CSP media-src). To allow another site, add it here AND to
// media-src in index.html and vite.config.js; the test checks all three.
export const DIRECT_HOSTS = ['archive.org']

// Every shared video needs one of these, so the feed stays about the two of you.
export const TAGS = ['Kissing', 'Romantic', 'Flirty', 'ASMR', 'Spicy']

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const fail = (m) => { throw new Error(m) }

// Returns { provider: 'youtube'|'vimeo'|'facebook'|'file', url (clean link to the original), embed | src }
export function parseVideoUrl(input) {
  let u
  try { u = new URL(String(input).trim()) } catch { return fail('That does not look like a link.') }
  if (u.protocol !== 'https:') return fail('Links must start with https://')
  if (u.username || u.password) return fail('That link is not supported.')
  const host = u.hostname.toLowerCase().replace(/^(www|m|web)\./, '')
  const parts = u.pathname.split('/').filter(Boolean)

  // ----- YouTube (privacy-enhanced mode: no tracking cookies until you press play) -----
  if (host === 'youtube.com' || host === 'youtu.be') {
    let id
    if (host === 'youtu.be') id = parts[0]
    else if (parts[0] === 'watch') id = u.searchParams.get('v')
    else if (['shorts', 'embed', 'live'].includes(parts[0])) id = parts[1]
    if (!YT_ID.test(id ?? '')) return fail('Could not find a YouTube video in that link.')
    return { provider: 'youtube', url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0` }
  }

  // ----- Vimeo -----
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const i = host === 'player.vimeo.com' ? 1 : 0
    const id = parts[i]
    const hash = host === 'player.vimeo.com' ? u.searchParams.get('h') : parts[i + 1]
    if (!/^\d{4,12}$/.test(id ?? '')) return fail('Could not find a Vimeo video in that link.')
    if (hash && !/^[0-9a-f]{6,20}$/i.test(hash)) return fail('Could not find a Vimeo video in that link.')
    return {
      provider: 'vimeo',
      url: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`,
      embed: `https://player.vimeo.com/video/${id}?dnt=1${hash ? `&h=${hash}` : ''}`,
    }
  }

  // ----- Facebook: one public video or reel at a time -----
  if (host === 'facebook.com' || host === 'fb.watch') {
    let canonical
    if (host === 'fb.watch') {
      if (!/^[A-Za-z0-9_-]{4,30}$/.test(parts[0] ?? '')) return fail('Could not find a Facebook video in that link.')
      canonical = `https://fb.watch/${parts[0]}/`
    } else if (parts[0] === 'reel' && /^\d{6,20}$/.test(parts[1] ?? '')) {
      canonical = `https://www.facebook.com/reel/${parts[1]}`
    } else if (parts[0] === 'watch' && /^\d{6,20}$/.test(u.searchParams.get('v') ?? '')) {
      canonical = `https://www.facebook.com/watch/?v=${u.searchParams.get('v')}`
    } else if (parts.includes('videos') && /^\d{6,20}$/.test(parts[parts.indexOf('videos') + 1] ?? '')) {
      canonical = `https://www.facebook.com/${parts.slice(0, parts.indexOf('videos') + 2).map(encodeURIComponent).join('/')}`
    } else if (parts[0] === 'share' && ['r', 'v'].includes(parts[1]) && /^[A-Za-z0-9_-]{4,30}$/.test(parts[2] ?? '')) {
      canonical = `https://www.facebook.com/share/${parts[1]}/${parts[2]}/`
    } else return fail('Open the reel on Facebook, tap Share, copy the link and paste it here.')
    return { provider: 'facebook', url: canonical, embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonical)}&show_text=false` }
  }

  // ----- direct video files from named sites only -----
  if (/\.(mp4|webm|m4v)$/i.test(u.pathname) && DIRECT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { provider: 'file', url: u.href, src: u.href }
  }
  return fail(`Supported: YouTube, Vimeo, a single Facebook reel or video, and video files from ${DIRECT_HOSTS.join(', ')}.`)
}

// Validates a shared video, whether made on this phone or received from the other one.
export function cleanWatch(w) {
  if (!w || typeof w.url !== 'string' || w.url.length > 400 || !TAGS.includes(w.tag)) throw new Error('bad video')
  const p = parseVideoUrl(w.url)
  return { url: p.url, tag: w.tag, provider: p.provider }
}
