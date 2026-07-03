import { supabase } from './server/supabase.js';

async function checkBurst() {
  const { data, error } = await supabase.from('signals').select('*').gte('created_at', '2026-06-25T14:30:40Z').lte('created_at', '2026-06-25T14:30:42Z');
  console.log("Burst count:", data?.length);
  if (data) {
      data.slice(0, 10).forEach(d => console.log(d.id, d.pair, d.direction, d.created_at, d.ai_reason));
  }
}
checkBurst();
