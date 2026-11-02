// Device-local storage (IndexedDB). Holds the non-extractable CryptoKeys (structured-cloned,
// so the key material itself is never readable by JS) and this device's message history,
// which is encrypted at rest with a separate non-extractable AES key.
import { encrypt, decrypt, generateLocalKey, messageAad } from './crypto.js'

const DB_NAME = 'valentine'
const DB_VERSION = 1

let dbPromise
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv')
      req.result.createObjectStore('msgs', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function run(store, mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    tx.oncomplete = () => resolve(req?.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export const kvGet = (k) => run('kv', 'readonly', (s) => s.get(k))
export const kvSet = (k, v) => run('kv', 'readwrite', (s) => s.put(v, k))
export const kvDel = (k) => run('kv', 'readwrite', (s) => s.delete(k))

// Wipes everything on this device: keys, room info and history.
export async function wipeDevice() {
  const d = await db()
  d.close()
  dbPromise = undefined
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = resolve
    req.onerror = () => reject(req.error)
    req.onblocked = resolve
  })
}

async function localKey() {
  let key = await kvGet('localKey')
  if (!key) {
    key = await generateLocalKey()
    await kvSet('localKey', key)
  }
  return key
}

// message = { id, from: 'me'|'peer', text, ts, delivered, failed }
export async function saveMessage(roomId, message) {
  const key = await localKey()
  const { ciphertext, nonce } = await encrypt(key, JSON.stringify(message), messageAad('local', roomId, message.id))
  await run('msgs', 'readwrite', (s) => s.put({ id: message.id, roomId, ts: message.ts, ciphertext, nonce }))
}

export async function hasMessage(id) {
  return Boolean(await run('msgs', 'readonly', (s) => s.getKey(id)))
}

export async function loadMessages(roomId) {
  const key = await localKey()
  const rows = (await run('msgs', 'readonly', (s) => s.getAll())) ?? []
  const out = []
  for (const r of rows) {
    if (r.roomId !== roomId) continue
    try {
      out.push(JSON.parse(await decrypt(key, r.ciphertext, r.nonce, messageAad('local', roomId, r.id))))
    } catch {
      /* unreadable local record: skip */
    }
  }
  return out.sort((a, b) => a.ts - b.ts)
}
