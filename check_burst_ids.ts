import { supabase } from './server/supabase.js';

async function checkBurstIDs() {
  const { data, error } = await supabase.from('signals').select('*').eq('pair', 'EURUSD').gte('created_at', '2026-06-25T14:30:40Z').lte('created_at', '2026-06-25T14:30:42Z');
  console.log("EURUSD Burst count:", data?.length);
  if (data) {
      data.forEach(d => console.log(d.id, d.pair, d.entry_price));
  }
}
checkBurstIDs();
