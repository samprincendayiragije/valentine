import { useCallback, useEffect, useState } from 'react'
import { secretGet, secretSet } from './store.js'
import { cleanDeck } from './games.js'

// Your own decks, kept only on this phone (encrypted at rest). Sharing one sends it as an encrypted message.
export function useDecks() {
  const [decks, setDecks] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let off = false
    secretGet('decks').then((d) => {
      if (off) return
      const clean = []
      for (const x of Array.isArray(d) ? d : []) { try { clean.push(cleanDeck(x)) } catch { /* skip */ } }
      setDecks(clean)
      setReady(true)
    }).catch(() => setReady(true))
    return () => { off = true }
  }, [])

  const persist = useCallback((next) => { setDecks(next); return secretSet('decks', next) }, [])

  const saveDeck = useCallback((deck) => {
    const clean = cleanDeck(deck)
    return persist([...decks.filter((d) => d.id !== clean.id), clean])
  }, [decks, persist])

  const removeDeck = useCallback((id) => persist(decks.filter((d) => d.id !== id)), [decks, persist])

  return { decks, ready, saveDeck, removeDeck }
}
