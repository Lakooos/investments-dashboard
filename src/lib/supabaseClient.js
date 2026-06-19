// Browser Supabase client (anon/publishable key — safe for the client). Used only
// in partner mode for user auth. Returns null if env isn't set, so the app can show
// a helpful message instead of crashing.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && anon ? createClient(url, anon) : null
