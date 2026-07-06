import { supabase } from './supabase.js';

console.log('=== CONNECTION INFO ===');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL || 'NOT SET');
console.log('SUPABASE_SERVICE_ROLE_KEY length:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0);

// Test connection works
const { data, error } = await supabase.from('signals').select('count', { count: 'exact', head: true });
console.log('\nConnection test:');
console.log('  Error:', error?.message || 'none');
console.log('  Count returned:', data);
