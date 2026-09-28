import { createClient } from '@supabase/supabase-js';

const rawSupabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
const rawSupabaseKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

// Sanitize inputs to prevent wrapping quotes from breaking the client
const supabaseUrl = rawSupabaseUrl.replace(/^["']|["']$/g, '').trim();
const supabaseKey = rawSupabaseKey.replace(/^["']|["']$/g, '').trim();

export const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
