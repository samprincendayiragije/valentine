import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isConfigured, ensureUser } from './supabase.js'
import {
  generateDeviceKeyPair, deriveSharedKey, encrypt, decrypt, messageAad, safetyCode,
  generatePairingCode, hashPairingCode, isValidPairingCode,
} from './crypto.js'
import { kvGet, kvSet, kvDel, wipeDevice, saveMessage, hasMessage, loadMessages } from './store.js'

export const MAX_LEN = 2000
const POLL_WAITING_MS = 3000
const POLL_PAIRED_MS = 8000

// Phases: loading | unconfigured | setup | waiting | paired | closed
export function useRoom() {
  const [phase, setPhase] = useState('loading')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [safety, setSafety] = useState(null)
  const [verified, setVerified] = useState(false)
  const [keyChanged, setKeyChanged] = useState(false)
  const [closedReason, setClosedReason] = useState('')
  const [messages, setMessages] = useState([])
  const [online, setOnline] = useState(navigator.onLine)

  // Everything mutable and non-visual lives here (never rendered, never sent anywhere).
  const c = useRef({ seen: new Set(), sending: new Set(), msgs: [], channel: null, ticking: false })

  const setMsgs = useCallback((updater) => {
    c.current.msgs = updater(c.current.msgs).slice().sort((a, b) => a.ts - b.ts)
    setMessages(c.current.msgs)
  }, [])

  const upsert = useCallback((msg) => {
    setMsgs((prev) => [...prev.filter((m) => m.id !== msg.id), msg])
  }, [setMsgs])

  // ----- receiving -----
  const processIncoming = useCallback(async (rows) => {
    const { meta, sharedKey } = c.current
    if (!sharedKey) return
    const ackIds = []
    for (const row of rows) {
      if (row.sender_id === meta.userId) continue
      if (c.current.seen.has(row.id) || (await hasMessage(row.id))) { ackIds.push(row.id); continue }
      c.current.seen.add(row.id)
      let msg
      try {
        const plain = await decrypt(sharedKey, row.ciphertext, row.nonce, messageAad(meta.roomId, row.sender_id, row.id))
        const p = JSON.parse(plain)
        msg = {
          id: row.id, from: 'peer', text: String(p.t).slice(0, MAX_LEN),
          ts: Math.min(Number(p.ts) || Date.parse(row.created_at), Date.now() + 60000), delivered: true,
        }
      } catch {
        // Wrong key, tampering or corruption. Keep a visible marker rather than hiding it.
        msg = { id: row.id, from: 'peer', text: '', ts: Date.parse(row.created_at), delivered: true, undecryptable: true }
      }
      await saveMessage(meta.roomId, msg)   // stored on this device BEFORE we tell the server to delete
      upsert(msg)
      ackIds.push(row.id)
    }
    if (ackIds.length) await supabase.rpc('ack_messages', { p_ids: ackIds })
  }, [upsert])

  const refreshDelivery = useCallback(async () => {
    const { meta } = c.current
    const pending = c.current.msgs.filter((m) => m.from === 'me' && !m.delivered && !m.failed && !c.current.sending.has(m.id))
    if (!pending.length) return
    const { data, error: e } = await supabase.from('messages').select('id').eq('room_id', meta.roomId).eq('sender_id', meta.userId)
    if (e) return
    const onServer = new Set(data.map((r) => r.id))
    for (const m of pending) {
      if (!onServer.has(m.id)) {   // gone from the server = the other device acknowledged it
        const done = { ...m, delivered: true }
        await saveMessage(meta.roomId, done)
        upsert(done)
      }
    }
  }, [upsert])

  // ----- pairing / sync -----
  const enterPaired = useCallback(async () => {
    const { meta, privateKey } = c.current
    c.current.sharedKey = await deriveSharedKey({
      privateKey, myPublicB64: meta.myPub, peerPublicB64: meta.peerPub, roomId: meta.roomId,
    })
    setSafety(await safetyCode({ roomId: meta.roomId, keyA: meta.myPub, keyB: meta.peerPub }))
    setVerified(Boolean(meta.verified))
    setMsgs(() => [])
    const history = await loadMessages(meta.roomId)
    history.forEach((m) => c.current.seen.add(m.id))
    c.current.lastTs = history.reduce((t, m) => Math.max(t, m.from === 'me' ? m.ts : 0), 0)
    setMsgs(() => history)
    setCode('')
    setPhase('paired')
  }, [setMsgs])

  const tick = useCallback(async () => {
    const x = c.current
    if (x.ticking || !x.meta || !supabase) return
    x.ticking = true
    try {
      const { data: members, error: e } = await supabase.from('members').select('user_id,public_key').eq('room_id', x.meta.roomId)
      if (e) return                                          // offline / transient: try again later
      if (!members.some((m) => m.user_id === x.meta.userId)) {
        setClosedReason('room'); setPhase('closed'); return  // room closed by the other person
      }
      const peer = members.find((m) => m.user_id !== x.meta.userId)
      if (!x.meta.peerPub) {                                 // still waiting for the partner
        if (!peer) return
        x.meta = { ...x.meta, peerPub: peer.public_key, code: undefined }
        await kvSet('meta', x.meta)
        await enterPaired()
        return
      }
      if (peer && peer.public_key !== x.meta.peerPub) setKeyChanged(true)
      const { data: rows, error: e2 } = await supabase
        .from('messages').select('id,sender_id,ciphertext,nonce,created_at')
        .eq('room_id', x.meta.roomId).neq('sender_id', x.meta.userId).order('created_at')
      if (!e2 && rows?.length) await processIncoming(rows)
      await refreshDelivery()
    } finally {
      x.ticking = false
    }
  }, [enterPaired, processIncoming, refreshDelivery])

  const subscribe = useCallback(() => {
    const { meta } = c.current
    if (c.current.channel) supabase.removeChannel(c.current.channel)
    const filter = `room_id=eq.${meta.roomId}`
    c.current.channel = supabase
      .channel(`room-${meta.roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter },
        (p) => { if (c.current.sharedKey) processIncoming([p.new]).catch(() => {}) })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'members', filter }, () => tick())
      .subscribe()
  }, [processIncoming, tick])

  // ----- startup -----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isConfigured) { setPhase('unconfigured'); return }
      const [meta, privateKey] = await Promise.all([kvGet('meta'), kvGet('priv')])
      if (cancelled) return
      if (!meta || !privateKey) { setPhase('setup'); return }
      c.current.meta = meta
      c.current.privateKey = privateKey
      try {
        const user = await ensureUser()
        if (user.id !== meta.userId) { setClosedReason('session'); setPhase('closed'); return }
      } catch { /* offline: carry on with local data */ }
      if (meta.peerPub) await enterPaired()
      else { setCode(meta.code ?? ''); setPhase('waiting') }
      subscribe()
      tick()
    })().catch((e) => { setError(e.message); setPhase('setup') })
    return () => { cancelled = true }
  }, [enterPaired, subscribe, tick])

  // poll as a safety net for realtime; also refresh when the app returns to the foreground
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'paired') return
    const every = phase === 'waiting' ? POLL_WAITING_MS : POLL_PAIRED_MS
    const id = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) tick() }, every)
    const wake = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', wake)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', wake) }
  }, [phase, tick])

  useEffect(() => {
    const up = () => { setOnline(true); tick() }, down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [tick])

  useEffect(() => () => { if (c.current.channel) supabase?.removeChannel(c.current.channel) }, [])

  // ----- actions -----
  const create = useCallback(async () => {
    setError(''); setBusy(true)
    try {
      const user = await ensureUser()
      const kp = await generateDeviceKeyPair()
      const newCode = generatePairingCode()
      await kvSet('priv', kp.privateKey)
      const { data: roomId, error: e } = await supabase.rpc('create_room', {
        p_code_hash: await hashPairingCode(newCode), p_public_key: kp.publicKeyB64,
      })
      if (e) { await kvDel('priv'); throw e }
      const meta = { roomId, userId: user.id, myPub: kp.publicKeyB64, code: newCode, role: 'creator', verified: false }
      await kvSet('meta', meta)
      c.current.meta = meta; c.current.privateKey = kp.privateKey
      setCode(newCode); setPhase('waiting')
      subscribe()
    } catch { setError('Could not create the room. Check your connection and try again.') }
    finally { setBusy(false) }
  }, [subscribe])

  const join = useCallback(async (input) => {
    setError('')
    if (!isValidPairingCode(input)) { setError('That code does not look right. It has 12 letters and numbers.'); return }
    setBusy(true)
    try {
      const user = await ensureUser()
      const kp = await generateDeviceKeyPair()
      await kvSet('priv', kp.privateKey)
      const { data: roomId, error: e } = await supabase.rpc('join_room', {
        p_code_hash: await hashPairingCode(input), p_public_key: kp.publicKeyB64,
      })
      if (e) { await kvDel('priv'); setError('That code did not work. It may be wrong, already used, or expired.'); return }
      const { data: members } = await supabase.from('members').select('user_id,public_key').eq('room_id', roomId)
      const peer = members?.find((m) => m.user_id !== user.id)
      if (!peer) { await kvDel('priv'); setError('Joined, but could not read the other key. Ask for a new code.'); return }
      const meta = { roomId, userId: user.id, myPub: kp.publicKeyB64, peerPub: peer.public_key, role: 'joiner', verified: false }
      await kvSet('meta', meta)
      c.current.meta = meta; c.current.privateKey = kp.privateKey
      await enterPaired()
      subscribe()
    } catch { setError('Could not join. Check your connection and try again.') }
    finally { setBusy(false) }
  }, [enterPaired, subscribe])

  const markVerified = useCallback(async () => {
    c.current.meta = { ...c.current.meta, verified: true }
    await kvSet('meta', c.current.meta)
    setVerified(true)
  }, [])

  const deliver = useCallback(async (msg) => {
    const { meta, sharedKey } = c.current
    c.current.sending.add(msg.id)
    try {
      const { ciphertext, nonce } = await encrypt(
        sharedKey, JSON.stringify({ t: msg.text, ts: msg.ts }), messageAad(meta.roomId, meta.userId, msg.id))
      const { error: e } = await supabase.from('messages').insert({
        id: msg.id, room_id: meta.roomId, sender_id: meta.userId, ciphertext, nonce,
      })
      const next = { ...msg, failed: Boolean(e) }
      await saveMessage(meta.roomId, next)
      upsert(next)
    } catch {
      const next = { ...msg, failed: true }
      await saveMessage(meta.roomId, next)
      upsert(next)
    } finally {
      c.current.sending.delete(msg.id)
    }
  }, [upsert])

  const send = useCallback(async (text) => {
    const clean = text.trim().slice(0, MAX_LEN)
    if (!clean || keyChanged || !c.current.sharedKey) return
    // strictly increasing, so two quick sends can never tie and swap order
    const ts = Math.max(Date.now(), (c.current.lastTs ?? 0) + 1)
    c.current.lastTs = ts
    const msg = { id: crypto.randomUUID(), from: 'me', text: clean, ts, delivered: false, failed: false }
    upsert(msg)
    await deliver(msg)
  }, [deliver, upsert, keyChanged])

  const retry = useCallback((id) => {
    const m = c.current.msgs.find((x) => x.id === id)
    if (m) deliver({ ...m, failed: false })
  }, [deliver])

  const reset = useCallback(async () => {
    try {
      if (c.current.meta?.roomId) await supabase.rpc('close_room', { p_room: c.current.meta.roomId })
      await supabase?.auth.signOut()
    } catch { /* best effort: local wipe below is what matters */ }
    if (c.current.channel) supabase?.removeChannel(c.current.channel)
    await wipeDevice()
    c.current = { seen: new Set(), sending: new Set(), msgs: [], channel: null, ticking: false }
    setMessages([]); setSafety(null); setVerified(false); setKeyChanged(false); setCode(''); setError(''); setClosedReason('')
    setPhase('setup')
  }, [])

  return { phase, error, busy, code, safety, verified, keyChanged, closedReason, messages, online,
    create, join, markVerified, send, retry, reset }
}
