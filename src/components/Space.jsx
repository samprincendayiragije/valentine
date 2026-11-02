import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Copy, Lock, ShieldCheck, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react'
import { useRoom } from '../lib/room.js'
import Chat from './Chat.jsx'
import Qr from './Qr.jsx'
import SafetyCode, { MismatchWarning } from './SafetyCode.jsx'
import InstallButton from './InstallButton.jsx'

const Card = ({ children }) => <div className="mx-auto w-full max-w-md rounded-2xl border border-pink-500/30 bg-purple-950/30 p-6">{children}</div>
const Primary = (p) => <button {...p} className="w-full rounded-full bg-purple-600 py-2.5 font-medium hover:bg-purple-500 disabled:opacity-50" />
const Err = ({ children }) => (children ? <p role="alert" className="mt-3 text-sm text-red-300">{children}</p> : null)

function Setup({ room, install }) {
  const [input, setInput] = useState(() => {
    const m = window.location.hash.match(/^#join=([A-Za-z0-9-]+)$/)
    return m ? m[1] : ''
  })
  useEffect(() => { if (window.location.hash.startsWith('#join=')) history.replaceState(null, '', window.location.pathname) }, [])
  return (
    <div className="space-y-4 p-4">
      <Card>
        <h2 className="text-xl font-semibold">Start a private room</h2>
        <p className="mt-1 text-sm text-slate-300">Gets you a one-time code to give to the other person. Only two people can ever be in a room.</p>
        <div className="mt-4"><Primary onClick={room.create} disabled={room.busy}>Create room</Primary></div>
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">Join with a code</h2>
        <input
          value={input} onChange={(e) => setInput(e.target.value)} placeholder="XXXX-XXXX-XXXX" aria-label="Pairing code"
          autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          className="mt-3 w-full rounded-xl bg-slate-800 px-4 py-2 text-center font-mono text-lg tracking-widest outline-none focus:ring-2 focus:ring-purple-500"
        />
        <div className="mt-3"><Primary onClick={() => room.join(input)} disabled={room.busy || !input}>Join room</Primary></div>
        <Err>{room.error}</Err>
      </Card>
      <div className="flex justify-center"><InstallButton install={install} /></div>
    </div>
  )
}

function Waiting({ room, onReset }) {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}${import.meta.env.BASE_URL}#join=${room.code}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(room.code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }
  return (
    <div className="p-4">
      <Card>
        <h2 className="text-center text-xl font-semibold">Share this code</h2>
        <p className="mt-3 text-center font-mono text-3xl tracking-widest" aria-label="Pairing code">{room.code}</p>
        <button onClick={copy} className="mx-auto mt-3 flex items-center gap-2 rounded-full border border-white/20 px-4 py-1.5 text-sm hover:bg-white/10">
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy code'}
        </button>
        <div className="mt-5 flex justify-center"><Qr text={link} label="QR code that opens the join screen" /></div>
        <p className="mt-4 text-center text-sm text-slate-300">
          Easiest: on the other phone, open the installed app, tap Join room and type the code.
          The QR opens the join screen in a browser, which only works if that browser is where they will use the app.
        </p>
        <p className="mt-3 text-center text-sm text-purple-200">Waiting for them to join… The code works once and expires in 30 minutes.</p>
        <button onClick={onReset} className="mx-auto mt-4 block text-sm text-slate-400 underline">Cancel</button>
      </Card>
    </div>
  )
}

function Closed({ room, onReset }) {
  return (
    <div className="p-4">
      <Card>
        <TriangleAlert className="mx-auto mb-2 text-amber-300" />
        <h2 className="text-center text-xl font-semibold">This room is no longer available</h2>
        <p className="mt-2 text-center text-sm text-slate-300">
          {room.closedReason === 'session'
            ? 'This browser lost its anonymous sign-in (for example, site data was cleared), so it can no longer open this room.'
            : 'The room was closed by the other person, or the pairing code expired before anyone joined.'}{' '}
          Old messages on this phone stay unreadable to the server either way. Start over to pair again.
        </p>
        <div className="mt-4"><Primary onClick={onReset}>Clear this phone and start over</Primary></div>
      </Card>
    </div>
  )
}

export default function Space({ onExit, install }) {
  const room = useRoom()
  const [showSafety, setShowSafety] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const reset = async () => { setMismatch(false); setConfirmLeave(false); setShowSafety(false); await room.reset() }

  let body
  if (room.phase === 'loading') body = <p className="p-8 text-center text-slate-400">Opening…</p>
  else if (room.phase === 'unconfigured')
    body = <Card><h2 className="text-lg font-semibold">Chat backend not set up</h2><p className="mt-2 text-sm text-slate-300">This build has no Supabase URL and anon key. See the README for setup.</p></Card>
  else if (room.phase === 'setup') body = <Setup room={room} install={install} />
  else if (room.phase === 'waiting') body = <Waiting room={room} onReset={reset} />
  else if (room.phase === 'closed') body = <Closed room={room} onReset={reset} />
  else if (mismatch) body = <div className="p-4"><MismatchWarning onReset={reset} onBack={() => setMismatch(false)} /></div>
  else if (!room.verified && !skipped)
    body = (
      <div className="p-4">
        <SafetyCode safety={room.safety} verified={false} onVerify={room.markVerified} onMismatch={() => setMismatch(true)} />
        <button onClick={() => setSkipped(true)} className="mx-auto mt-4 block text-sm text-slate-400 underline">Compare later</button>
      </div>
    )
  else if (showSafety)
    body = <div className="p-4"><SafetyCode safety={room.safety} verified={room.verified} onVerify={room.markVerified} onMismatch={() => { setShowSafety(false); setMismatch(true) }} onClose={() => setShowSafety(false)} /></div>
  else
    body = (
      <>
        {room.keyChanged && (
          <div role="alert" className="bg-red-900/70 px-4 py-3 text-sm">
            <b>The other person’s key changed.</b> Sending is turned off. Someone may be interfering with this room.
            Compare your safety code, and if in doubt delete the room and pair again.
          </div>
        )}
        {!room.verified && <button onClick={() => setShowSafety(true)} className="bg-amber-900/60 px-4 py-2 text-left text-sm">Safety code not compared yet. Tap to compare.</button>}
        <Chat messages={room.messages} onSend={room.send} onRetry={room.retry} disabled={room.keyChanged} online={room.online} />
      </>
    )

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button onClick={onExit} aria-label="Back to the front page" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"><ArrowLeft size={20} /></button>
        <h1 className="flex items-center gap-2 font-medium"><Lock size={16} className="text-purple-300" /> Private chat</h1>
        {room.phase === 'paired' ? (
          <div className="flex items-center">
            <button onClick={() => setShowSafety(true)} aria-label="Safety code" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">
              {room.verified ? <ShieldCheck size={20} className="text-emerald-300" /> : <ShieldAlert size={20} className="text-amber-300" />}
            </button>
            <button onClick={() => setConfirmLeave(true)} aria-label="Delete room" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"><Trash2 size={18} /></button>
          </div>
        ) : <span className="w-9" />}
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</main>
      {confirmLeave && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-20 grid place-items-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-5">
            <h2 className="text-lg font-semibold">Delete this room?</h2>
            <p className="mt-2 text-sm text-slate-300">This erases the room for both of you, deletes the keys and all messages on this phone, and cannot be undone.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmLeave(false)} className="rounded-full border border-white/20 py-2">Cancel</button>
              <button onClick={reset} className="rounded-full bg-red-600 py-2 font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
