import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isConfigured, ensureUser } from './supabase.js'
import {
  generateDeviceKeyPair, deriveSharedKey, encrypt, decrypt, messageAad, safetyCode,
  generatePairingCode, hashPairingCode, isValidPairingCode, encryptBytes, decryptBytes, mediaAad,
} from './crypto.js'
import { kvGet, kvSet, kvDel, wipeDevice, saveMessage, hasMessage, loadMessages, saveMedia, loadMedia } from './store.js'
import { MAX_LEN, MAX_MEDIA_BYTES, baseMime, encodePayload, decodePayload } from './wire.js'

export { MAX_LEN }
const BUCKET = 'valentine-media'
const WEEK_MS = 7 * 24 * 3600 * 1000
const POLL_WAITING_MS = 3000
const POLL_PAIRED_MS = 8000

// Downloads, decrypts and stores an incoming file. 'ok' | 'retry' | 'missing' | 'bad'
async function fetchMedia(x, row, msg) {
  const { meta, sharedKey } = x
  const { data, error } = await supabase.storage.from(BUCKET).download(`${meta.roomId}/${row.id}`)
  if (error || !data) {
    const gone = error?.status === 404 || /not found|404/i.test(error?.message ?? '')
    return gone ? 'missing' : 'retry'
  }
  try {
    const bytes = await decryptBytes(sharedKey, new Uint8Array(await data.arrayBuffer()), mediaAad(meta.roomId, row.sender_id, row.id))
    if (bytes.length !== msg.media.size) return 'bad'
    await saveMedia(meta.roomId, row.id, bytes)
    return 'ok'
  } catch {
    return 'bad'
  }
}

// Removes files left on the server for more than 7 days, or all of them when closing the room.
async function cleanServerMedia(roomId, { all = false } = {}) {
  try {
    const { data } = await supabase.storage.from(BUCKET).list(roomId, { limit: 100 })
    const old = (data ?? []).filter((o) => all || Date.now() - Date.parse(o.created_at) > WEEK_MS).map((o) => `${roomId}/${o.name}`)
    if (old.length) await supabase.storage.from(BUCKET).remove(old)
  } catch { /* best effort */ }
}

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
  const c = useRef({ seen: new Set(), inflight: new Set(), sending: new Set(), msgs: [], channel: null, ticking: false })

  const setMsgs = useCallback((updater) => {
    c.current.msgs = updater(c.current.msgs).slice().sort((a, b) => a.ts - b.ts)
    setMessages(c.current.msgs)
  }, [])

  const upsert = useCallback((msg) => {
    setMsgs((prev) => [...prev.filter((m) => m.id !== msg.id), msg])
  }, [setMsgs])

  // ----- receiving -----
  const processIncoming = useCallback(async (rows) => {
    const x = c.current
    const { meta, sharedKey } = x
    if (!sharedKey) return
    const ackIds = []
    const mediaPaths = []
    for (const row of rows) {
      if (row.sender_id === meta.userId) continue
      if (x.inflight.has(row.id)) continue            // already being handled (realtime + poll can overlap)
      x.inflight.add(row.id)
      try {
        const path = `${meta.roomId}/${row.id}`
        if (x.seen.has(row.id) || (await hasMessage(row.id))) {
          ackIds.push(row.id)
          if (x.msgs.find((m) => m.id === row.id)?.kind === 'media') mediaPaths.push(path)
          continue
        }
        let msg
        try {
          const plain = await decrypt(sharedKey, row.ciphertext, row.nonce, messageAad(meta.roomId, row.sender_id, row.id))
          const fields = decodePayload(JSON.parse(plain), Date.parse(row.created_at))
          msg = { id: row.id, from: 'peer', delivered: true, ...fields }
        } catch {
          // Wrong key, tampering or corruption. Keep a visible marker rather than hiding it.
          msg = { id: row.id, from: 'peer', kind: 'text', text: '', ts: Date.parse(row.created_at), delivered: true, undecryptable: true }
        }
        if (msg.kind === 'media') {
          const got = await fetchMedia(x, row, msg)
          if (got === 'retry') continue                 // offline or not uploaded yet: try again next time, do not acknowledge
          if (got === 'missing') msg.mediaMissing = true
          if (got === 'bad') msg = { id: row.id, from: 'peer', kind: 'text', text: '', ts: msg.ts, delivered: true, undecryptable: true }
          if (msg.kind === 'media') mediaPaths.push(path)
        }
        await saveMessage(meta.roomId, msg)             // stored on this device BEFORE we tell the server to delete
        x.seen.add(row.id)
        upsert(msg)
        ackIds.push(row.id)
      } finally {
        x.inflight.delete(row.id)
      }
    }
    if (ackIds.length) await supabase.rpc('ack_messages', { p_ids: ackIds })
    if (mediaPaths.length) { try { await supabase.storage.from(BUCKET).remove(mediaPaths) } catch { /* swept after 7 days */ } }
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
    cleanServerMedia(meta.roomId)
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
      if (msg.kind === 'media') {
        const blob = await loadMedia(meta.roomId, msg.id, msg.media.mime)
        if (!blob) throw new Error('file missing on this device')
        const sealed = await encryptBytes(sharedKey, new Uint8Array(await blob.arrayBuffer()), mediaAad(meta.roomId, meta.userId, msg.id))
        const { error: ue } = await supabase.storage.from(BUCKET).upload(`${meta.roomId}/${msg.id}`, sealed, { contentType: 'application/octet-stream' })
        // "already exists" = an earlier attempt got the file up but not the message; the file is self-contained, so carry on
        if (ue && !/already exists|duplicate/i.test(ue.message ?? '')) throw ue
      }
      const { ciphertext, nonce } = await encrypt(
        sharedKey, JSON.stringify(encodePayload(msg)), messageAad(meta.roomId, meta.userId, msg.id))
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

  const sendFields = useCallback(async (fields, id = crypto.randomUUID()) => {
    if (keyChanged || !c.current.sharedKey) return
    // strictly increasing, so two quick sends can never tie and swap order
    const ts = Math.max(Date.now(), (c.current.lastTs ?? 0) + 1)
    c.current.lastTs = ts
    const msg = { id, from: 'me', ts, delivered: false, failed: false, ...fields }
    upsert(msg)
    await deliver(msg)
  }, [deliver, upsert, keyChanged])

  const send = useCallback(async (text) => {
    const clean = text.trim().slice(0, MAX_LEN)
    if (!clean) return
    await sendFields({ kind: 'text', text: clean })
  }, [sendFields])

  // Returns an error message, or '' when the file was queued.
  const sendMedia = useCallback(async (blob, kind, { dur = 0, caption = '' } = {}) => {
    const mime = baseMime(blob.type)
    if (blob.size < 1) return 'That file is empty.'
    if (blob.size > MAX_MEDIA_BYTES) return `That file is too big. The limit is ${MAX_MEDIA_BYTES / 1024 / 1024} MB.`
    const media = { kind, mime, size: blob.size, dur }
    try { decodePayload({ k: 'media', ts: Date.now(), m: media }, Date.now()) } catch { return 'That file type is not supported.' }
    if (keyChanged || !c.current.sharedKey) return 'Sending is turned off.'
    const id = crypto.randomUUID()
    try { await saveMedia(c.current.meta.roomId, id, new Uint8Array(await blob.arrayBuffer())) } catch { return 'Could not read that file.' }
    await sendFields({ kind: 'media', text: caption.trim().slice(0, MAX_LEN), media }, id)
    return ''
  }, [sendFields, keyChanged])

  const sendDeck = useCallback((deck) => sendFields({ kind: 'deck', deck }), [sendFields])
  const sendPlay = useCallback((play) => sendFields({ kind: 'play', play }), [sendFields])
  const sendWatch = useCallback((watch) => sendFields({ kind: 'watch', watch }), [sendFields])
  const getMedia = useCallback((m) => loadMedia(c.current.meta.roomId, m.id, m.media.mime), [])

  const retry = useCallback((id) => {
    const m = c.current.msgs.find((x) => x.id === id)
    if (m) deliver({ ...m, failed: false })
  }, [deliver])

  const reset = useCallback(async () => {
    try {
      if (c.current.meta?.roomId) {
        await cleanServerMedia(c.current.meta.roomId, { all: true })
        await supabase.rpc('close_room', { p_room: c.current.meta.roomId })
      }
      await supabase?.auth.signOut()
    } catch { /* best effort: local wipe below is what matters */ }
    if (c.current.channel) supabase?.removeChannel(c.current.channel)
    await wipeDevice()
    c.current = { seen: new Set(), inflight: new Set(), sending: new Set(), msgs: [], channel: null, ticking: false }
    setMessages([]); setSafety(null); setVerified(false); setKeyChanged(false); setCode(''); setError(''); setClosedReason('')
    setPhase('setup')
  }, [])

  return { phase, error, busy, code, safety, verified, keyChanged, closedReason, messages, online,
    create, join, markVerified, send, sendMedia, sendDeck, sendPlay, sendWatch, getMedia, retry, reset }
}
