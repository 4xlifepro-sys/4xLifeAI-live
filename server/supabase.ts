import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseUrl = rawSupabaseUrl
  .replace(/^["']|["']$/g, '')
  .trim()
  .replace(/\/(rest|auth)\/v1\/?$/i, '')
  .replace(/\/$/, '');

let serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^["']|["']$/g, '').trim();
const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').replace(/^["']|["']$/g, '').trim();

// Publishable keys cannot validate auth tokens on the backend; fall back to anon key
if (serviceKey.startsWith('sb_publishable_') || serviceKey.length < 20) {
  console.warn('[server/supabase] SUPABASE_SERVICE_ROLE_KEY looks like a publishable or invalid key; falling back to anon key for token validation.');
  serviceKey = '';
}

const supabaseKey = serviceKey || anonKey;

export const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;
