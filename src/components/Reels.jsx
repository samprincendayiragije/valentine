import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, EyeOff, Play, Plus } from 'lucide-react'
import { TAGS, parseVideoUrl, DIRECT_HOSTS } from '../lib/embed.js'
import { kvGet, kvSet } from '../lib/store.js'
import { Gate } from './Games.jsx'

const NAMES = { youtube: 'YouTube', vimeo: 'Vimeo', facebook: 'Facebook', file: 'Video file' }

function Player({ p }) {
  if (p.provider === 'file') return <video src={p.src} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
  return (
    <iframe
      src={p.embed} title="Video" allowFullScreen
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
      className="h-full w-full border-0 bg-black"
    />
  )
}

function Item({ m, p, playing, onPlay, onHide }) {
  return (
    <section className="flex h-full snap-start flex-col gap-2 p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-full bg-pink-600/70 px-2 py-0.5">{m.watch.tag}</span>
        <span className="text-slate-400">{NAMES[p.provider]} · from {m.from === 'me' ? 'you' : 'your partner'}</span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-purple-950 to-slate-900">
        {playing ? <Player p={p} /> : (
          <button onClick={onPlay} className="grid h-full w-full place-items-center" aria-label="Play video">
            <span className="flex flex-col items-center gap-2 text-sm text-slate-200">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-white/15"><Play size={28} /></span>
              Tap to play
              <span className="max-w-60 text-center text-xs text-slate-400">{NAMES[p.provider]} loads only when you tap.</span>
            </span>
          </button>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 underline"><ExternalLink size={12} /> Open original</a>
        <button onClick={onHide} className="flex items-center gap-1 underline"><EyeOff size={12} /> Hide from my feed</button>
      </div>
    </section>
  )
}

export default function Reels({ messages, sendWatch, disabled }) {
  const [ack, setAck] = useState(null)
  const [hidden, setHidden] = useState([])
  const [filter, setFilter] = useState('All')
  const [playing, setPlaying] = useState(null)
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [tag, setTag] = useState('Romantic')
  const [err, setErr] = useState('')

  useEffect(() => {
    kvGet('gamesAck').then((v) => setAck(Boolean(v))).catch(() => setAck(false))
    kvGet('hiddenWatch').then((v) => setHidden(Array.isArray(v) ? v : [])).catch(() => {})
  }, [])

  const items = useMemo(() => {
    const out = []
    for (const m of messages) {
      if (m.kind !== 'watch' || hidden.includes(m.id)) continue
      if (filter !== 'All' && m.watch.tag !== filter) continue
      try { out.push({ m, p: parseVideoUrl(m.watch.url) }) } catch { /* skip invalid */ }
    }
    return out.reverse()   // newest first
  }, [messages, hidden, filter])

  if (ack === null) return null
  if (!ack) return <Gate onAccept={() => { kvSet('gamesAck', true); setAck(true) }} />

  const hide = (id) => { const next = [...hidden, id]; setHidden(next); kvSet('hiddenWatch', next); if (playing === id) setPlaying(null) }
  const add = async () => {
    setErr('')
    try {
      const p = parseVideoUrl(url)
      await sendWatch({ url: p.url, tag })
      setUrl(''); setAdding(false)
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
        {['All', ...TAGS].map((t) => (
          <button key={t} onClick={() => setFilter(t)} className={`shrink-0 rounded-full px-3 py-1 text-xs ${filter === t ? 'bg-pink-600' : 'bg-slate-800 text-slate-300'}`}>{t}</button>
        ))}
        <button onClick={() => setAdding((a) => !a)} disabled={disabled} className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-purple-600 px-3 py-1 text-xs disabled:opacity-40"><Plus size={13} /> Add</button>
      </div>

      {adding && (
        <div className="space-y-2 border-y border-white/10 bg-slate-900 p-3">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube, Vimeo or Facebook reel link" aria-label="Video link"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className="w-full rounded-xl bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500" />
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What is it about">
            {TAGS.map((t) => (
              <button key={t} role="radio" aria-checked={tag === t} onClick={() => setTag(t)} className={`rounded-full px-3 py-1 text-xs ${tag === t ? 'bg-pink-600' : 'bg-slate-800 text-slate-300'}`}>{t}</button>
            ))}
          </div>
          <p className="text-xs text-slate-400">Tag it honestly. Your partner sees the tag, and can hide anything from their feed. Video files work from: {DIRECT_HOSTS.join(', ')}.</p>
          {err && <p role="alert" className="text-xs text-red-300">{err}</p>}
          <button onClick={add} disabled={!url.trim() || disabled} className="w-full rounded-full bg-purple-600 py-2 text-sm font-medium disabled:opacity-40">Share to our feed</button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="m-auto max-w-xs p-6 text-center text-sm text-slate-400">
          Nothing here yet. Add a link and it shows up for both of you. Swipe up for the next one.
        </p>
      ) : (
        <div className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto">
          {items.map(({ m, p }) => (
            <div key={m.id} className="h-full">
              <Item m={m} p={p} playing={playing === m.id} onPlay={() => setPlaying(m.id)} onHide={() => hide(m.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
