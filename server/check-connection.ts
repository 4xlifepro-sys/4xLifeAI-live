import { supabase } from './supabase.js';

console.log('=== CONNECTION INFO ===');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL?.slice(0, 20) + '...' || 'NOT SET');
console.log('SUPABASE_URL length:', process.env.SUPABASE_URL?.length ?? 0);
console.log('SUPABASE_KEY set:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('RAILWAY_ENVIRONMENT:', process.env.RAILWAY_ENVIRONMENT || 'not set');
console.log('RAILWAY_SERVICE_NAME:', process.env.RAILWAY_SERVICE_NAME || 'not set');

// Test connection works
const { data, error } = await supabase.from('signals').select('count', { count: 'exact', head: true });
console.log('\nConnection test:');
console.log('  Error:', error?.message || 'none');
console.log('  Count returned:', data);
