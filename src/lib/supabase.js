// Only the public Supabase URL and anon key live in the client (see .env.example).
// Both are designed to be public; Row Level Security is what protects the data.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'valentine-auth' },
    })
  : null

// Anonymous sign-in: no email, no password, no profile. The session is the identity.
export async function ensureUser() {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session.user
  const { data: anon, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return anon.user
}
