import { supabase } from './server/supabase.js';

async function test() {
  if (!supabase) return;
  const { data, error } = await supabase.from('signals')
    .select('*')
    .eq('result', 'WIN')
    .not('pips_won', 'is', null)
    .not('closed_at', 'is', null)
    .limit(1);
    
  console.log(data);
}
test().then(() => process.exit(0));
