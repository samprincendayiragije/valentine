import { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, Send, TriangleAlert } from 'lucide-react'
import { MAX_LEN } from '../lib/room.js'

const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Bubble({ m, onRetry }) {
  const mine = m.from === 'me'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-purple-700 rounded-br-sm' : 'bg-slate-800 rounded-bl-sm'}`}>
        {m.undecryptable ? (
          <p className="flex items-center gap-1 text-sm italic text-amber-300"><TriangleAlert size={14} /> Could not decrypt this message</p>
        ) : (
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-white/60">
          <span>{time(m.ts)}</span>
          {mine && !m.failed && (m.delivered ? <CheckCheck size={14} aria-label="Delivered" /> : <Check size={14} aria-label="Sent" />)}
          {mine && m.failed && <button onClick={() => onRetry(m.id)} className="text-red-300 underline">Not sent, tap to retry</button>}
        </div>
      </div>
    </div>
  )
}

export default function Chat({ messages, onSend, onRetry, disabled, online }) {
  const [text, setText] = useState('')
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const submit = () => {
    if (!text.trim() || disabled) return
    onSend(text)
    setText('')
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-slate-400">
            Messages are encrypted on your phone before they leave it. Say hi.
          </p>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} onRetry={onRetry} />)}
        <div ref={end} />
      </div>
      <div className="border-t border-white/10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {!online && <p className="px-2 pb-1 text-xs text-amber-300">Offline. Messages will not send until you are back online.</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            rows={1}
            disabled={disabled}
            placeholder={disabled ? 'Sending is disabled' : 'Message'}
            aria-label="Message"
            className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl bg-slate-800 px-4 py-2 outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
          />
          <button onClick={submit} disabled={disabled || !text.trim()} aria-label="Send"
            className="grid h-10 w-10 place-items-center rounded-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40">
            <Send size={18} />
          </button>
        </div>
      </div>
    </>
  )
}
