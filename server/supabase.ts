import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseUrl = rawSupabaseUrl.replace(/^["']|["']$/g, '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').replace(/^["']|["']$/g, '').trim(); // Prefer service role for backend operations, or anon key

export const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;
