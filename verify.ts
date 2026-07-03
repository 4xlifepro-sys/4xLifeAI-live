import { supabase } from './server/supabase.js';

async function run() {
  if (!supabase) return;

  const { count: winNullPips } = await supabase.from('signals').select('*', { count: 'exact', head: true })
    .eq('result', 'WIN').is('pips_won', null);
  console.log("1. Count signals where result = 'WIN' AND pips_won IS NULL:", winNullPips);

  const { count: lossNullPips } = await supabase.from('signals').select('*', { count: 'exact', head: true })
    .eq('result', 'LOSS').is('pips_lost', null);
  console.log("2. Count signals where result = 'LOSS' AND pips_lost IS NULL:", lossNullPips);

  console.log("\n3. Closure code that updates result, pips_won, pips_lost, closed_at:");
  console.log("Checking codebase for update statements... (There is none for the 'signals' table updating result/pips_won. It seems the old tracker was removed or never implemented properly for `signals`, while `signal_audit_log` only updates `status`)");

  const { data: winTrades } = await supabase.from('signals').select('pair, entry_price, sl, tp1, closed_at, pips_won')
    .eq('result', 'WIN').limit(10);
  console.log("\n4. 10 WIN trades:");
  console.log(JSON.stringify(winTrades, null, 2));

  const { data: lossTrades } = await supabase.from('signals').select('pair, entry_price, sl, closed_at, pips_lost')
    .eq('result', 'LOSS').limit(10);
  console.log("\n5. 10 LOSS trades:");
  console.log(JSON.stringify(lossTrades, null, 2));

  console.log("\n6. If pips_won or pips_lost are NULL after closure, explain why:");
  console.log("If pips_won or pips_lost is NULL, it is because the tracking code or seed data inserted WIN/LOSS states without actually calculating the pips gained/lost. In looking at the codebase, there is actually no active code running that updates `result`, `pips_won`, `pips_lost`, or `closed_at` on the `signals` table for real-time tracking. The current real-time tracking loop inside `scanner.ts` only updates `signal_audit_log.status` (to 'TP1 HIT', 'SL HIT', etc.) and does not record pips, calculate results, or write back to `signals.result`.");
}
run().then(() => process.exit(0));
