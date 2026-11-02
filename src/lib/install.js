import { useEffect, useState } from 'react'

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

export const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent)

// Captures the browser's install prompt (Chrome/Android/desktop). iOS has none, so we show instructions.
export function useInstall() {
  const [evt, setEvt] = useState(null)
  const [installed, setInstalled] = useState(isStandalone())
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setEvt(e) }
    const onInstalled = () => { setEvt(null); setInstalled(true) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  const prompt = async () => {
    if (!evt) return
    evt.prompt()
    await evt.userChoice
    setEvt(null)
  }
  return { canPrompt: Boolean(evt), installed, ios: isIOS(), prompt }
}
