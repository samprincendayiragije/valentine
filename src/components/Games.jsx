import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Dices, MessageCircle, Pencil, Play, Plus, Send, SkipForward, Trash2 } from 'lucide-react'
import { BUILTIN_DECKS, LIMITS, audience, cleanDeck, deriveSession, drawIndex } from '../lib/games.js'
import { kvGet, kvSet } from '../lib/store.js'

const Btn = ({ tone = 'solid', className = '', ...p }) => (
  <button {...p} className={`rounded-full px-4 py-2 text-sm font-medium disabled:opacity-40 ${
    tone === 'solid' ? 'bg-purple-600 hover:bg-purple-500' : 'border border-white/20 hover:bg-white/10'} ${className}`} />
)

const AUDIENCE = { you: 'For you', partner: 'For your partner', both: 'For both of you' }
const TO_LABEL = { drawer: 'Whoever draws it', other: 'The other person', both: 'Both of you' }

export function Gate({ onAccept }) {
  return (
    <div className="p-4">
      <div className="mx-auto max-w-md rounded-2xl border border-pink-500/30 bg-purple-950/30 p-6">
        <h2 className="text-xl font-semibold">Games for two</h2>
        <p className="mt-2 text-sm text-slate-300">
          Flirty and spicy games for two adults who both want to play. Before you start:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>You are both 18 or older.</li>
          <li>Anyone can pass any card, any time, with no reason needed.</li>
          <li>Only share photos, videos and voice notes you are comfortable sharing. The other person can screenshot or save anything you send.</li>
        </ul>
        <Btn className="mt-5 w-full" onClick={onAccept}>We are both 18+ and ready</Btn>
      </div>
    </div>
  )
}

function DeckRow({ deck, onPlay, onEdit, onShare, disabled }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden="true">{deck.emoji ?? '🃏'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{deck.title}</p>
          <p className="text-xs text-slate-400">{deck.level ? `${deck.level} · ` : ''}{deck.cards.length} cards</p>
        </div>
        <Btn onClick={() => onPlay(deck)} disabled={disabled} className="flex items-center gap-1"><Play size={14} /> Play</Btn>
      </div>
      {(onEdit || onShare) && (
        <div className="mt-2 flex gap-2">
          {onEdit && <Btn tone="ghost" onClick={() => onEdit(deck)} className="flex items-center gap-1 !py-1"><Pencil size={13} /> Edit</Btn>}
          {onShare && <Btn tone="ghost" onClick={() => onShare(deck)} disabled={disabled} className="flex items-center gap-1 !py-1"><Send size={13} /> Send to partner</Btn>}
        </div>
      )}
    </div>
  )
}

function Editor({ initial, onSave, onDelete, onBack }) {
  const [title, setTitle] = useState(initial.title)
  const [cards, setCards] = useState(initial.cards.length ? initial.cards : [{ t: '', to: 'drawer' }])
  const [err, setErr] = useState('')
  const setCard = (i, patch) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const save = async () => {
    try {
      const deck = cleanDeck({ id: initial.id, title, cards: cards.filter((c) => c.t.trim()) })
      await onSave(deck)
    } catch (e) {
      setErr(e.message === 'Deck too large' ? 'That deck is too long to send. Shorten some cards.' : 'Give the deck a title and at least one card.')
    }
  }

  return (
    <div className="space-y-3 p-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-300"><ArrowLeft size={16} /> Back</button>
      <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, LIMITS.title))} placeholder="Deck title" aria-label="Deck title"
        className="w-full rounded-xl bg-slate-800 px-4 py-2 outline-none focus:ring-2 focus:ring-purple-500" />
      <p className="text-xs text-slate-400">Write your own cards, as tame or as spicy as the two of you like. Decks stay on your phones and only travel encrypted.</p>
      {cards.map((c, i) => (
        <div key={i} className="rounded-2xl border border-white/10 bg-slate-900 p-3">
          <textarea value={c.t} onChange={(e) => setCard(i, { t: e.target.value.slice(0, LIMITS.card) })} rows={2} placeholder={`Card ${i + 1}`} aria-label={`Card ${i + 1}`}
            className="w-full resize-none rounded-xl bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500" />
          <div className="mt-2 flex items-center gap-2">
            <select value={c.to} onChange={(e) => setCard(i, { to: e.target.value })} aria-label="Who is this card for"
              className="flex-1 rounded-xl bg-slate-800 px-2 py-1.5 text-sm">
              {Object.entries(TO_LABEL).map(([k, v]) => <option key={k} value={k}>For: {v}</option>)}
            </select>
            <button onClick={() => setCards((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove card" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
      {cards.length < LIMITS.cards && <Btn tone="ghost" onClick={() => setCards((cs) => [...cs, { t: '', to: 'drawer' }])} className="flex items-center gap-1"><Plus size={14} /> Add card</Btn>}
      {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
      <div className="flex gap-2">
        <Btn onClick={save} className="flex-1">Save deck</Btn>
        {onDelete && <Btn tone="ghost" onClick={onDelete} className="!text-red-300">Delete</Btn>}
      </div>
    </div>
  )
}

function Session({ session, onDraw, onResolve, onEnd, onBack, onGoChat, disabled }) {
  const card = session.current ? session.deck.cards[session.current.idx] : null
  const byMe = session.current?.by === 'me'
  const aud = card ? audience(card, byMe) : null
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-300"><ArrowLeft size={16} /> Games</button>
        <button onClick={onEnd} disabled={disabled} className="text-sm text-slate-400 underline">End game</button>
      </div>
      <div>
        <h2 className="text-lg font-semibold">{session.deck.title}</h2>
        <p className="text-xs text-slate-400">{session.used.length} of {session.deck.cards.length} cards drawn · {session.done} done · {session.passed} passed</p>
      </div>

      {card ? (
        <div className="rounded-3xl border border-pink-500/40 bg-gradient-to-br from-purple-900/60 to-pink-900/40 p-6">
          <p className="text-xs uppercase tracking-wider text-pink-200">{byMe ? 'You drew' : 'Your partner drew'} · {AUDIENCE[aud]}</p>
          <p className="mt-3 text-xl leading-snug">{card.t}</p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Btn onClick={() => onResolve('done')} disabled={disabled} className="flex items-center justify-center gap-1"><Check size={16} /> Done</Btn>
            <Btn tone="ghost" onClick={() => onResolve('pass')} disabled={disabled} className="flex items-center justify-center gap-1"><SkipForward size={16} /> Pass</Btn>
          </div>
          <Btn tone="ghost" onClick={onGoChat} className="mt-2 flex w-full items-center justify-center gap-1"><MessageCircle size={16} /> Reply in chat (text, photo, voice, video)</Btn>
          <p className="mt-3 text-center text-xs text-slate-400">Passing is always okay. No reason needed.</p>
        </div>
      ) : session.finished ? (
        <div className="rounded-3xl border border-white/10 bg-slate-900 p-6 text-center">
          <p className="text-lg">That was the whole deck 💞</p>
          <Btn onClick={onEnd} disabled={disabled} className="mt-4">Finish</Btn>
        </div>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-slate-900 p-6 text-center">
          {session.turn === 'me' ? (
            <>
              <p className="text-slate-300">Your turn</p>
              <Btn onClick={onDraw} disabled={disabled} className="mt-4 flex w-full items-center justify-center gap-2"><Dices size={18} /> Draw a card</Btn>
            </>
          ) : (
            <p className="text-slate-300">Waiting for your partner to draw a card…</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function Games({ messages, decksApi, sendPlay, sendDeck, onGoChat, disabled }) {
  const { decks, saveDeck, removeDeck } = decksApi
  const [ack, setAck] = useState(null)       // null = loading
  const [view, setView] = useState('home')   // home | edit | play
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { kvGet('gamesAck').then((v) => setAck(Boolean(v))).catch(() => setAck(false)) }, [])
  const session = useMemo(() => deriveSession(messages.filter((m) => m.kind === 'play')), [messages])

  if (ack === null) return null
  if (!ack) return <Gate onAccept={() => { kvSet('gamesAck', true); setAck(true) }} />

  const start = async (deck) => {
    setErr('')
    try {
      await sendPlay({ op: 'start', gid: crypto.randomUUID(), deck: cleanDeck(deck) })
      setView('play')
    } catch { setErr('Could not start that deck.') }
  }
  const newDeck = () => { setEditing({ id: crypto.randomUUID(), title: '', cards: [] }); setView('edit') }

  if (view === 'edit' && editing) {
    const exists = decks.some((d) => d.id === editing.id)
    return (
      <Editor
        key={editing.id}
        initial={editing}
        onBack={() => setView('home')}
        onSave={async (deck) => { await saveDeck(deck); setView('home') }}
        onDelete={exists ? async () => { await removeDeck(editing.id); setView('home') } : null}
      />
    )
  }

  if (view === 'play' && session) {
    return (
      <Session
        session={session} disabled={disabled}
        onBack={() => setView('home')} onGoChat={onGoChat}
        onDraw={() => { const idx = drawIndex(session); if (idx !== null) sendPlay({ op: 'draw', gid: session.gid, idx }) }}
        onResolve={(op) => sendPlay({ op, gid: session.gid, idx: session.current.idx })}
        onEnd={() => { sendPlay({ op: 'end', gid: session.gid }); setView('home') }}
      />
    )
  }

  return (
    <div className="space-y-5 p-4">
      {session && (
        <button onClick={() => setView('play')} className="flex w-full items-center justify-between rounded-2xl bg-pink-900/40 px-4 py-3 text-left">
          <span><span className="block text-sm font-medium">Game in progress</span><span className="text-xs text-pink-100/80">{session.deck.title}</span></span>
          <Play size={18} />
        </button>
      )}
      {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
      {disabled && <p className="text-sm text-amber-300">Games are paused because the other person’s key changed.</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Decks</h2>
        {BUILTIN_DECKS.map((d) => <DeckRow key={d.id} deck={d} onPlay={start} disabled={disabled} />)}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Your decks</h2>
        {decks.length === 0 && <p className="text-sm text-slate-400">Make your own cards and games, as sweet or as spicy as you like.</p>}
        {decks.map((d) => (
          <DeckRow key={d.id} deck={d} onPlay={start} disabled={disabled}
            onEdit={(x) => { setEditing(x); setView('edit') }}
            onShare={async (x) => { try { await sendDeck(x); onGoChat() } catch { setErr('Could not send that deck.') } }} />
        ))}
        <Btn tone="ghost" onClick={newDeck} className="flex w-full items-center justify-center gap-1"><Plus size={16} /> Create a deck</Btn>
      </section>
    </div>
  )
}
