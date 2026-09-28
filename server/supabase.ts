import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseUrl = rawSupabaseUrl
  .replace(/^["']|["']$/g, '')
  .trim()
  .replace(/\/(rest|auth)\/v1\/?$/i, '')
  .replace(/\/$/, '');
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').replace(/^["']|["']$/g, '').trim();

export const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;
