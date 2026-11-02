import { Download } from 'lucide-react'

export default function InstallButton({ install }) {
  if (install.installed) return null
  if (install.canPrompt)
    return (
      <button onClick={install.prompt} className="flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-1.5 text-sm text-white hover:bg-white/10">
        <Download size={16} /> Install app
      </button>
    )
  if (install.ios)
    return <p className="max-w-xs text-center text-xs text-slate-300">To install on iPhone: tap Share, then “Add to Home Screen”. Open the installed app before pairing.</p>
  return null
}
