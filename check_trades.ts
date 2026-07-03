import { supabase } from './server/supabase.js';

async function checkTrades() {
  const { data, error } = await supabase.from('trades').select('*');
  console.log("Error:", error);
  console.log("Trades count:", data?.length);
  if (data) {
      data.forEach(d => console.log(d.pair, d.status, d.opened_at, d.closed_at));
  }
}
checkTrades();
