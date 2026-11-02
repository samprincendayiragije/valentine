import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseVideoUrl, cleanWatch, FRAME_HOSTS, DIRECT_HOSTS } from '../src/lib/embed.js'
import { encodePayload, decodePayload } from '../src/lib/wire.js'

const ok = (u) => parseVideoUrl(u)

test('YouTube links in every common shape use the no-cookie player', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5', 'https://youtu.be/dQw4w9WgXcQ?si=x', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://youtube.com/live/dQw4w9WgXcQ']) {
    const p = ok(u)
    assert.equal(p.provider, 'youtube')
    assert.equal(p.embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0')
  }
  assert.throws(() => ok('https://www.youtube.com/watch?v=short'))
  assert.throws(() => ok('https://www.youtube.com/@somechannel'))
})

test('Vimeo, including unlisted links with a hash', () => {
  assert.equal(ok('https://vimeo.com/123456789').embed, 'https://player.vimeo.com/video/123456789?dnt=1')
  assert.equal(ok('https://vimeo.com/123456789/abcdef1234').embed, 'https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234')
  assert.throws(() => ok('https://vimeo.com/channels/staffpicks'))
})

test('Facebook: single reels and videos only, no feeds or pages', () => {
  assert.equal(ok('https://www.facebook.com/reel/1234567890123').url, 'https://www.facebook.com/reel/1234567890123')
  assert.equal(ok('https://m.facebook.com/watch/?v=1234567890123&ref=x').url, 'https://www.facebook.com/watch/?v=1234567890123')
  assert.equal(ok('https://www.facebook.com/somepage/videos/1234567890123/').provider, 'facebook')
  assert.equal(ok('https://www.facebook.com/share/r/AbC123xyz/').provider, 'facebook')
  assert.equal(ok('https://fb.watch/abc123XYZ/').provider, 'facebook')
  assert.match(ok('https://www.facebook.com/reel/1234567890123').embed, /^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/)
  assert.throws(() => ok('https://www.facebook.com/'))
  assert.throws(() => ok('https://www.facebook.com/reel/'))
  assert.throws(() => ok('https://www.facebook.com/somepage'))
})

test('direct files only from named sites, https only, no tricks', () => {
  assert.equal(ok('https://archive.org/download/x/clip.mp4').provider, 'file')
  assert.equal(ok('https://ia800000.us.archive.org/1/items/x/clip.webm').provider, 'file')
  assert.throws(() => ok('https://evil.example/clip.mp4'))
  assert.throws(() => ok('https://archive.org.evil.example/clip.mp4'))
  assert.throws(() => ok('https://notarchive.org/clip.mp4'))
  assert.throws(() => ok('http://archive.org/clip.mp4'))
  assert.throws(() => ok('https://user:pw@archive.org/clip.mp4'))
  assert.throws(() => ok('javascript:alert(1)'))
  assert.throws(() => ok('not a link'))
})

test('cleanWatch needs a known tag and survives the wire format', () => {
  assert.throws(() => cleanWatch({ url: 'https://youtu.be/dQw4w9WgXcQ', tag: 'Other' }))
  assert.throws(() => cleanWatch({ url: 'https://evil.example/x', tag: 'Kissing' }))
  const watch = cleanWatch({ url: 'https://youtu.be/dQw4w9WgXcQ', tag: 'ASMR' })
  const back = decodePayload(JSON.parse(JSON.stringify(encodePayload({ kind: 'watch', ts: 1, watch }))), 1)
  assert.equal(back.kind, 'watch')
  assert.equal(back.watch.tag, 'ASMR')
  assert.throws(() => decodePayload({ k: 'watch', ts: 1, w: { url: 'https://evil.example/x', tag: 'ASMR' } }, 1))
})

test('the Content-Security-Policy allows exactly the hosts the code can use', () => {
  for (const file of ['index.html', 'vite.config.js']) {
    const csp = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    const frame = csp.match(/frame-src ([^;"`]*)/)?.[1].split(' ').filter(Boolean)
    assert.deepEqual(frame?.sort(), [...FRAME_HOSTS].sort(), `${file} frame-src`)
    const media = csp.match(/media-src ([^;"`]*)/)?.[1] ?? ''
    for (const h of DIRECT_HOSTS) assert.ok(media.includes(`https://${h}`) && media.includes(`https://*.${h}`), `${file} media-src ${h}`)
  }
  // every embed URL the parser can produce lives on a framed host
  for (const u of ['https://youtu.be/dQw4w9WgXcQ', 'https://vimeo.com/123456789', 'https://www.facebook.com/reel/1234567890123']) {
    assert.ok(FRAME_HOSTS.includes(new URL(ok(u).embed).origin))
  }
})
