
import { createClient } from '@supabase/supabase-js'

const viteEnv = typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string | undefined> }).env
  ? (import.meta as { env?: Record<string, string | undefined> }).env!
  : {};

export const supabaseEnabled = Boolean(viteEnv.VITE_SUPABASE_URL && viteEnv.VITE_SUPABASE_ANON_KEY);
const supabaseUrl = viteEnv.VITE_SUPABASE_URL || 'https://example.invalid';
const supabaseKey = viteEnv.VITE_SUPABASE_ANON_KEY || 'local-dev-disabled';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    schema: 'public'
  }
})
