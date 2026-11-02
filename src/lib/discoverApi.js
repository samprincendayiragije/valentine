// Browser-only part of Discover: the one place that talks to Google. It only runs when someone opens Discover.
import { QUERIES, buildUrl, parseResults } from './discover.js'

const key = import.meta.env.VITE_YOUTUBE_API_KEY
export const discoverConfigured = Boolean(key)

// Returns { items, next, done }. `qi` walks through the tag's queries; `done` means every query has been used.
export async function fetchPage(tag, qi, pageToken) {
  const queries = QUERIES[tag]
  if (qi >= queries.length) return { items: [], next: undefined, done: true }
  let res
  try { res = await fetch(buildUrl({ q: queries[qi], pageToken, key }), { referrerPolicy: 'strict-origin-when-cross-origin' }) } catch { throw new Error('No connection. Try again.') }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason
    if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded') throw new Error('Today’s search limit is used up. Try again tomorrow.')
    if (res.status === 400 || res.status === 403) throw new Error('The search key was refused. Check the setup in the README.')
    throw new Error('Search failed. Try again.')
  }
  return { ...parseResults(json), done: false }
}
