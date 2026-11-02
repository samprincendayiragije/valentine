import { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, Clapperboard, Eye, Image as ImageIcon, Mic, Send, Square, TriangleAlert, X, Layers, Dices } from 'lucide-react'
import { MAX_LEN, MAX_AUDIO_SECS } from '../lib/wire.js'
import { prepareImage, pickRecorderMime } from '../lib/media.js'

const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function MediaBody({ m, getMedia }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const [revealed, setRevealed] = useState(m.from === 'me')   // photos and videos you receive stay blurred until you tap
  const kind = m.media.kind

  useEffect(() => {
    if (m.mediaMissing) return undefined
    let off = false
    let made
    getMedia(m).then((blob) => {
      if (off) return
      if (!blob) { setFailed(true); return }
      made = URL.createObjectURL(blob)
      setUrl(made)
    }).catch(() => { if (!off) setFailed(true) })
    return () => { off = true; if (made) URL.revokeObjectURL(made) }
  }, [m, getMedia])

  if (m.mediaMissing || failed) {
    return <p className="flex items-center gap-1 text-sm italic text-amber-300"><TriangleAlert size={14} /> This {kind} is no longer available</p>
  }
  if (!url) return <p className="text-sm italic text-white/60">Loading {kind}…</p>
  if (kind === 'audio') return <audio src={url} controls preload="metadata" className="max-w-full" />

  return (
    <div className="relative overflow-hidden rounded-xl">
      {kind === 'image'
        ? <img src={url} alt="Photo" className={`max-h-80 w-full object-contain ${revealed ? '' : 'blur-3xl'}`} />
        : <video src={url} controls={revealed} playsInline preload="metadata" className={`max-h-80 w-full ${revealed ? '' : 'blur-3xl'}`} />}
      {!revealed && (
        <button onClick={() => setRevealed(true)} className="absolute inset-0 grid place-items-center bg-black/30 text-sm font-medium">
          <span className="flex items-center gap-1 rounded-full bg-black/60 px-3 py-1"><Eye size={14} /> Tap to view</span>
        </button>
      )}
    </div>
  )
}

function Body({ m, getMedia, savedIds, onSaveDeck, onWatch }) {
  if (m.undecryptable) return <p className="flex items-center gap-1 text-sm italic text-amber-300"><TriangleAlert size={14} /> Could not decrypt this message</p>
  if (m.kind === 'unsupported') return <p className="text-sm italic text-amber-300">This message needs a newer version of the app.</p>
  if (m.kind === 'media') {
    return (
      <div className="space-y-1">
        <MediaBody m={m} getMedia={getMedia} />
        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
      </div>
    )
  }
  if (m.kind === 'watch') {
    return (
      <div className="min-w-48">
        <p className="flex items-center gap-1 text-sm font-semibold"><Clapperboard size={14} /> Shared a video</p>
        <p className="text-xs capitalize text-white/70">{m.watch.provider} · {m.watch.tag}</p>
        <button onClick={onWatch} className="mt-2 rounded-full bg-white/15 px-3 py-1 text-xs hover:bg-white/25">Watch in Reels</button>
      </div>
    )
  }
  if (m.kind === 'deck') {
    const saved = savedIds.has(m.deck.id)
    return (
      <div className="min-w-48">
        <p className="flex items-center gap-1 text-sm font-semibold"><Layers size={14} /> {m.deck.title}</p>
        <p className="text-xs text-white/70">A game deck · {m.deck.cards.length} cards</p>
        {m.from === 'peer' && (
          <button onClick={() => onSaveDeck(m.deck)} disabled={saved}
            className="mt-2 rounded-full bg-white/15 px-3 py-1 text-xs hover:bg-white/25 disabled:opacity-60">
            {saved ? 'Saved in Games' : 'Save to my decks'}
          </button>
        )}
      </div>
    )
  }
  return <p className="whitespace-pre-wrap break-words">{m.text}</p>
}

function Bubble({ m, onRetry, getMedia, savedIds, onSaveDeck, onWatch }) {
  const mine = m.from === 'me'
  if (m.kind === 'play') {
    if (m.play.op !== 'start' && m.play.op !== 'end') return null
    return (
      <p className="flex items-center justify-center gap-1 py-1 text-xs text-slate-400">
        <Dices size={12} /> {m.play.op === 'start' ? `${mine ? 'You' : 'Your partner'} started a game: ${m.play.deck.title}` : 'Game ended'}
      </p>
    )
  }
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-purple-700 rounded-br-sm' : 'bg-slate-800 rounded-bl-sm'}`}>
        <Body m={m} getMedia={getMedia} savedIds={savedIds} onSaveDeck={onSaveDeck} onWatch={onWatch} />
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-white/60">
          <span>{time(m.ts)}</span>
          {mine && !m.failed && (m.delivered ? <CheckCheck size={14} aria-label="Delivered" /> : <Check size={14} aria-label="Sent" />)}
          {mine && m.failed && <button onClick={() => onRetry(m.id)} className="text-red-300 underline">Not sent, tap to retry</button>}
        </div>
      </div>
    </div>
  )
}

function Recorder({ onSend, onCancel }) {
  const [secs, setSecs] = useState(0)
  const [error, setError] = useState('')
  const state = useRef({ action: 'cancel', secs: 0, rec: null, stream: null })
  const cb = useRef({ onSend, onCancel })
  useEffect(() => { cb.current = { onSend, onCancel } })

  useEffect(() => {
    const st = state.current
    let timer
    let dead = false
    const chunks = []
    ;(async () => {
      try {
        const mime = pickRecorderMime()
        if (mime === null) throw new Error('unsupported')
        st.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (dead) { st.stream.getTracks().forEach((t) => t.stop()); return }
        const rec = new MediaRecorder(st.stream, mime ? { mimeType: mime } : undefined)
        st.rec = rec
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
        rec.onstop = () => {
          clearInterval(timer)
          st.stream?.getTracks().forEach((t) => t.stop())
          if (st.action === 'send' && chunks.length) cb.current.onSend(new Blob(chunks, { type: rec.mimeType }), st.secs)
          else cb.current.onCancel()
        }
        rec.start()
        timer = setInterval(() => {
          st.secs += 1
          setSecs(st.secs)
          if (st.secs >= MAX_AUDIO_SECS) { st.action = 'send'; rec.state !== 'inactive' && rec.stop() }
        }, 1000)
      } catch {
        setError('Could not use the microphone. Check the browser permission for this site.')
      }
    })()
    return () => {
      dead = true
      clearInterval(timer)
      st.action = 'cancel'
      if (st.rec && st.rec.state !== 'inactive') st.rec.stop()
      st.stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const stop = (action) => { state.current.action = action; const r = state.current.rec; if (r && r.state !== 'inactive') r.stop(); else cb.current.onCancel() }

  if (error) return <div className="flex items-center gap-2 px-2 py-2 text-sm text-amber-300"><span className="flex-1">{error}</span><button onClick={onCancel} aria-label="Close"><X size={18} /></button></div>
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-slate-800 px-4 py-2">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
      <span className="flex-1 font-mono text-sm">{mmss(secs)} / {mmss(MAX_AUDIO_SECS)}</span>
      <button onClick={() => stop('cancel')} aria-label="Cancel recording" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"><X size={18} /></button>
      <button onClick={() => stop('send')} aria-label="Stop and send" className="grid h-9 w-9 place-items-center rounded-full bg-purple-600 hover:bg-purple-500"><Square size={14} /></button>
    </div>
  )
}

export default function Chat({ messages, onSend, onSendMedia, onRetry, getMedia, savedIds, onSaveDeck, onWatch, disabled, online }) {
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef(null)
  const file = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const submit = () => {
    if (!text.trim() || disabled) return
    onSend(text)
    setText('')
  }

  const pick = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || disabled) return
    setErr(''); setBusy(true)
    try {
      const caption = text
      let msg = ''
      if (f.type.startsWith('image/')) msg = await onSendMedia(await prepareImage(f), 'image', { caption })
      else if (f.type.startsWith('video/')) msg = await onSendMedia(f, 'video', { caption })
      else msg = 'Pick a photo or a video.'
      if (msg) setErr(msg); else setText('')
    } catch { setErr('Could not read that file.') } finally { setBusy(false) }
  }

  const sendVoice = async (blob, dur) => {
    setRecording(false); setErr('')
    const msg = await onSendMedia(blob, 'audio', { dur })
    if (msg) setErr(msg)
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-slate-400">
            Messages, photos, videos and voice notes are encrypted on your phone before they leave it. Say hi.
          </p>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} onRetry={onRetry} getMedia={getMedia} savedIds={savedIds} onSaveDeck={onSaveDeck} onWatch={onWatch} />)}
        <div ref={end} />
      </div>
      <div className="border-t border-white/10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {!online && <p className="px-2 pb-1 text-xs text-amber-300">Offline. Messages will not send until you are back online.</p>}
        {err && <p role="alert" className="px-2 pb-1 text-xs text-red-300">{err}</p>}
        {recording ? (
          <Recorder onSend={sendVoice} onCancel={() => setRecording(false)} />
        ) : (
          <div className="flex items-end gap-2">
            <input ref={file} type="file" accept="image/*,video/*" onChange={pick} className="hidden" />
            <button onClick={() => file.current?.click()} disabled={disabled || busy} aria-label="Send a photo or video"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-white/10 disabled:opacity-40"><ImageIcon size={20} /></button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              rows={1}
              disabled={disabled}
              placeholder={disabled ? 'Sending is disabled' : busy ? 'Preparing…' : 'Message'}
              aria-label="Message"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl bg-slate-800 px-4 py-2 outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            />
            {text.trim() ? (
              <button onClick={submit} disabled={disabled} aria-label="Send"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40"><Send size={18} /></button>
            ) : (
              <button onClick={() => setRecording(true)} disabled={disabled || busy} aria-label="Record a voice note"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40"><Mic size={18} /></button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
