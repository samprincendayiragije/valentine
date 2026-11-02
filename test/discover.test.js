import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { QUERIES, API_HOST, IMG_HOST, buildUrl, parseResults, decodeEntities, thumbUrl } from '../src/lib/discover.js'
import { TAGS } from '../src/lib/embed.js'

test('every tag has queries', () => {
  assert.deepEqual(Object.keys(QUERIES).sort(), [...TAGS].sort())
  for (const q of Object.values(QUERIES)) assert.ok(q.length >= 2)
})

test('search requests are embeddable-only, moderate SafeSearch, and exclude minors-related words', () => {
  const u = new URL(buildUrl({ q: 'romantic couple kiss', key: 'K', pageToken: 'abc_DEF-1' }))
  assert.equal(u.origin, API_HOST)
  assert.equal(u.searchParams.get('videoEmbeddable'), 'true')
  assert.equal(u.searchParams.get('safeSearch'), 'moderate')
  assert.equal(u.searchParams.get('type'), 'video')
  assert.equal(u.searchParams.get('pageToken'), 'abc_DEF-1')
  assert.match(u.searchParams.get('q'), /-teen/)
  assert.match(u.searchParams.get('q'), /-child/)
  assert.equal(new URL(buildUrl({ q: 'x', key: 'K', pageToken: 'bad token!' })).searchParams.has('pageToken'), false)
})

test('results are validated and entities decoded', () => {
  const r = parseResults({
    nextPageToken: 'CAoQAA',
    items: [
      { id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'Tom &amp; Jerry&#39;s &quot;kiss&quot;', channelTitle: 'A &lt;b&gt;' } },
      { id: { videoId: 'bad' }, snippet: { title: 'x' } },
      { id: { channelId: 'UC123' }, snippet: { title: 'channel' } },
      null,
    ],
  })
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].title, 'Tom & Jerry\'s "kiss"')
  assert.equal(r.next, 'CAoQAA')
  assert.equal(parseResults({ nextPageToken: '<script>' }).next, undefined)
  assert.deepEqual(parseResults(undefined), { items: [], next: undefined })
  assert.equal(decodeEntities('&#x1F600;'), '😀')
  assert.equal(thumbUrl('dQw4w9WgXcQ'), `${IMG_HOST}/vi/dQw4w9WgXcQ/hqdefault.jpg`)
})

test('the Content-Security-Policy allows the search API and thumbnails, and nothing else is added for them', () => {
  for (const file of ['index.html', 'vite.config.js']) {
    const csp = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.ok(csp.match(/connect-src ([^;"`]*)/)[1].split(' ').includes(API_HOST), `${file} connect-src`)
    assert.ok(csp.match(/img-src ([^;"`]*)/)[1].split(' ').includes(IMG_HOST), `${file} img-src`)
  }
})
