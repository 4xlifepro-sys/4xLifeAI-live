import { supabase } from './server/supabase.js';

async function audit() {
  const { data: signals, error: sigErr } = await supabase
    .from('signals')
    .select('*')
    .gte('created_at', '2026-06-26T00:00:00Z')
    .order('created_at', { ascending: false });

  console.log(`Signals today: ${signals?.length}`);
  if (signals) {
      signals.forEach(s => console.log(s.pair, s.direction, s.created_at, s.status, s.tier));
  }
}
audit();
