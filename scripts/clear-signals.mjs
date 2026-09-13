import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

async function clearSignals() {
  console.log('Deleting all signals...');
  const { error } = await supabase.from('signals').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
  console.log('All signals cleared.');
}

clearSignals();
