import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Play, Share2 } from 'lucide-react'
import { TAGS, parseVideoUrl } from '../lib/embed.js'
import { thumbUrl } from '../lib/discover.js'
import { discoverConfigured, fetchPage } from '../lib/discoverApi.js'

function Card({ v, playing, shared, onPlay, onShare, disabled }) {
  const p = parseVideoUrl(`https://www.youtube.com/watch?v=${v.id}`)
  return (
    <section className="flex h-full snap-start flex-col gap-2 p-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-black">
        {playing ? (
          <iframe src={p.embed} title={v.title || 'Video'} allowFullScreen allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
            className="h-full w-full border-0" />
        ) : (
          <button onClick={onPlay} aria-label={`Play ${v.title}`} className="group relative h-full w-full">
            <img src={thumbUrl(v.id)} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-70" />
            <span className="absolute inset-0 grid place-items-center"><span className="grid h-16 w-16 place-items-center rounded-full bg-black/60"><Play size={28} /></span></span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{v.title}</p>
          <p className="truncate text-xs text-slate-400">{v.channel} · YouTube</p>
        </div>
        <button onClick={onShare} disabled={shared || disabled}
          className="flex shrink-0 items-center gap-1 rounded-full bg-purple-600 px-3 py-1.5 text-xs disabled:opacity-60">
          {shared ? <><Check size={13} /> Shared</> : <><Share2 size={13} /> Share to our feed</>}
        </button>
      </div>
    </section>
  )
}

export default function Discover({ sendWatch, disabled }) {
  const [tag, setTag] = useState('Romantic')
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading')   // loading | idle | error | end
  const [err, setErr] = useState('')
  const [playing, setPlaying] = useState(null)
  const [shared, setShared] = useState([])
  const cur = useRef({ gen: 0, busy: false, qi: 0, token: undefined, seen: new Set() })

  const more = useCallback(async (t) => {
    const c = cur.current
    if (c.busy) return
    c.busy = true
    const gen = c.gen
    setStatus('loading'); setErr('')
    try {
      const page = await fetchPage(t, c.qi, c.token)
      if (gen !== c.gen) return
      if (page.done) { setStatus('end'); return }
      if (page.next) c.token = page.next; else { c.qi += 1; c.token = undefined }
      const fresh = page.items.filter((i) => !c.seen.has(i.id))
      fresh.forEach((i) => c.seen.add(i.id))
      setItems((prev) => [...prev, ...fresh])
      setStatus('idle')
    } catch (e) {
      if (gen === c.gen) { setErr(e.message); setStatus('error') }
    } finally {
      if (gen === c.gen) c.busy = false
    }
  }, [])

  useEffect(() => {
    if (!discoverConfigured) return
    const c = cur.current
    c.gen += 1; c.busy = false; c.qi = 0; c.token = undefined; c.seen = new Set()
    setItems([]); setPlaying(null)
    more(tag)
  }, [tag, more])

  if (!discoverConfigured) {
    return (
      <div className="m-auto max-w-sm space-y-2 p-6 text-sm text-slate-300">
        <p className="font-medium text-white">Discover is not switched on yet</p>
        <p>It needs a free YouTube search key. See “Discover setup” in the README: create the key, restrict it to this site, and add it as the GitHub variable <code className="text-pink-200">VITE_YOUTUBE_API_KEY</code>, then redeploy.</p>
      </div>
    )
  }

  const onScroll = (e) => {
    const el = e.currentTarget
    if (status === 'idle' && el.scrollTop + el.clientHeight * 3 > el.scrollHeight) more(tag)
  }
  const share = async (v) => {
    try { await sendWatch({ url: `https://www.youtube.com/watch?v=${v.id}`, tag }); setShared((s) => [...s, v.id]) } catch { setErr('Could not share that one.') }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-2" role="radiogroup" aria-label="What to look for">
        {TAGS.map((t) => (
          <button key={t} role="radio" aria-checked={tag === t} onClick={() => setTag(t)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${tag === t ? 'bg-pink-600' : 'bg-slate-800 text-slate-300'}`}>{t}</button>
        ))}
      </div>
      <p className="px-3 pb-1 text-[11px] text-slate-500">Results come from YouTube search and are not checked by us. Skip anything you do not like.</p>
      {err && <p role="alert" className="px-3 pb-1 text-xs text-red-300">{err} {status === 'error' && <button onClick={() => more(tag)} className="underline">Retry</button>}</p>}
      <div onScroll={onScroll} className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto">
        {items.map((v) => (
          <div key={v.id} className="h-full">
            <Card v={v} playing={playing === v.id} shared={shared.includes(v.id)} disabled={disabled} onPlay={() => setPlaying(v.id)} onShare={() => share(v)} />
          </div>
        ))}
        {status === 'loading' && <p className="p-6 text-center text-sm text-slate-400">Finding more…</p>}
        {status === 'end' && <p className="p-6 text-center text-sm text-slate-400">That is everything for this tag for now. Try another.</p>}
      </div>
    </div>
  )
}
