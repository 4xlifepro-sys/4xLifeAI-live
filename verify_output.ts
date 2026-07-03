import { supabase } from './server/supabase.js';

async function verify() {
  if (!supabase) return;

  const { count: winNullPips } = await supabase.from('signals').select('*', { count: 'exact', head: true })
    .eq('result', 'WIN').is('pips_won', null);
  console.log("1. Count signals where result = 'WIN' AND pips_won IS NULL:", winNullPips);

  const { count: lossNullPips } = await supabase.from('signals').select('*', { count: 'exact', head: true })
    .eq('result', 'LOSS').is('pips_lost', null);
  console.log("\n2. Count signals where result = 'LOSS' AND pips_lost IS NULL:", lossNullPips);

  console.log("\n3. Exact closure code that updates result, pips_won, pips_lost, closed_at:");
  console.log(`
=== THERE IS NO CODE IN THE REPOSITORY UPDATING THESE FIELDS ON THE 'signals' TABLE ===
The codebase only updates 'signal_audit_log.status'. 
The search \`grep -rn "from('signals').update" . \` returns no results.
The 'signals' table has no real-time update loop for TP/SL hits, and 'pips_won', 'pips_lost', and 'closed_at' are never updated dynamically. 

The closest code in the app updating an active signal is in 'server/scanner.ts', startScanner() function:

                 const { error: updateError } = await supabase
                   .from('signal_audit_log')
                   .update({ status: newStatus })
                   .eq('id', s.id);
                   
4. Code that prevents the same signal from being closed twice:
              if (s.status === 'ACTIVE') {
                 // only processes active trades.
`);

  const { data: winTrades } = await supabase.from('signals').select('pair, entry_price, sl, tp1, closed_at, pips_won')
    .eq('result', 'WIN').limit(10);
  console.log("4. Show 10 WIN trades:");
  console.log(JSON.stringify(winTrades, null, 2));

  const { data: lossTrades } = await supabase.from('signals').select('pair, entry_price, sl, closed_at, pips_lost')
    .eq('result', 'LOSS').limit(10);
  console.log("\n5. Show 10 LOSS trades:");
  console.log(JSON.stringify(lossTrades, null, 2));
  
  const { data: perfectWin } = await supabase.from('signals').select('*')
    .eq('result', 'WIN').not('pips_won', 'is', null).not('closed_at', 'is', null).limit(1);
  console.log("\n5. Show a real database record where result = WIN, pips_won is NOT NULL, closed_at is NOT NULL:");
  console.log(JSON.stringify(perfectWin, null, 2));

  console.log("\n6. If pips_won or pips_lost are NULL after closure, explain why:");
  console.log("They are NULL because the application's closure logic (in `server/scanner.ts`) only hits the `signal_audit_log` table to update the string `status` (e.g. 'TP1 HIT', 'SL HIT'). The `signals` table does not have an active database listener or chron job that writes back the calculated pip results. The data we are seeing in the `signals` table is likely legacy seeded data or manual insertions, which inserted 'WIN' and 'LOSS' results without actually calculating or populating the 'pips_won'/'pips_lost' columns.");

}

verify().then(() => process.exit(0));
