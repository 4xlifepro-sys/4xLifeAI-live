import { createClient } from '@supabase/supabase-js';

const runtimeConfig = (typeof window !== 'undefined' && (window as any).__SUPABASE_CONFIG__) || {};

const rawSupabaseUrl = runtimeConfig.url || (import.meta as any).env.VITE_SUPABASE_URL || '';
const rawSupabaseKey = runtimeConfig.key || (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

// Sanitize inputs: strip wrapping quotes and Supabase API path suffixes
const supabaseUrl = rawSupabaseUrl
  .replace(/^["']|["']$/g, '')
  .trim()
  .replace(/\/(rest|auth)\/v1\/?$/i, '')
  .replace(/\/$/, '');
const supabaseKey = rawSupabaseKey.replace(/^["']|["']$/g, '').trim();

export const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
