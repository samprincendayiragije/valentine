import { ShieldCheck, TriangleAlert } from 'lucide-react'

export default function SafetyCode({ safety, verified, onVerify, onMismatch, onClose }) {
  return (
    <div className="rounded-2xl border border-purple-500/30 bg-purple-950/40 p-5 text-center">
      <ShieldCheck className="mx-auto mb-2 text-purple-300" />
      <h2 className="text-lg font-semibold">Safety code</h2>
      <p className="mt-1 text-sm text-slate-300">
        Compare this with your person <b>in person or on a call</b>. Read it out loud. It must match exactly on both phones.
        If it does not, someone may be in the middle.
      </p>
      <p className="mt-4 font-mono text-xl tracking-widest text-white break-words" aria-label="Safety code digits">{safety.digits}</p>
      <p className="mt-3 text-3xl" aria-label="Safety code emoji">{safety.emoji}</p>
      {!verified ? (
        <div className="mt-5 grid gap-2">
          <button onClick={onVerify} className="rounded-full bg-purple-600 py-2 font-medium hover:bg-purple-500">They match</button>
          <button onClick={onMismatch} className="rounded-full border border-red-400/60 py-2 text-red-300 hover:bg-red-950/40">They do not match</button>
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-sm text-emerald-300">Marked as verified on this phone.</p>
          {onClose && <button onClick={onClose} className="mt-3 rounded-full border border-white/20 px-5 py-1.5 text-sm hover:bg-white/10">Close</button>}
        </div>
      )}
    </div>
  )
}

export function MismatchWarning({ onReset, onBack }) {
  return (
    <div className="rounded-2xl border border-red-500/50 bg-red-950/40 p-5 text-center">
      <TriangleAlert className="mx-auto mb-2 text-red-300" />
      <h2 className="text-lg font-semibold text-red-200">Do not use this room</h2>
      <p className="mt-2 text-sm text-slate-200">
        The codes differ, so the keys are not the ones you each created. Delete this room on both phones and pair again,
        ideally on a different network.
      </p>
      <div className="mt-4 grid gap-2">
        <button onClick={onReset} className="rounded-full bg-red-600 py-2 font-medium hover:bg-red-500">Delete room and start over</button>
        <button onClick={onBack} className="rounded-full border border-white/20 py-2 text-sm hover:bg-white/10">Back</button>
      </div>
    </div>
  )
}
