import { useState } from 'react'
import { Lock } from 'lucide-react'
import './App.css'
import Landing from './components/landingpage'
import Navbar from './components/navbar'
import Space from './components/Space'
import InstallButton from './components/InstallButton'
import { useInstall } from './lib/install'

export default function App() {
  // The landing page is always the front door; the chat sits behind one small button.
  // A #join=CODE link (from the pairing QR) goes straight to the join screen.
  const [view, setView] = useState(() => (window.location.hash.startsWith('#join=') ? 'chat' : 'landing'))
  const install = useInstall()

  if (view === 'chat') return <Space onExit={() => setView('landing')} install={install} />

  return (
    <div className="bg-slate-950 min-h-screen w-full">
      <Navbar />
      <Landing />
      <div className="fixed inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2 px-4 pb-[env(safe-area-inset-bottom)]">
        <button
          onClick={() => setView('chat')}
          className="flex items-center gap-2 rounded-full border border-pink-500/40 bg-black/50 px-5 py-2 text-sm text-pink-100 backdrop-blur hover:bg-white/10"
        >
          <Lock size={14} /> Our private space
        </button>
        <InstallButton install={install} />
      </div>
    </div>
  )
}
