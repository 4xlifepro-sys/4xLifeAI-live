import { supabase } from './server/supabase.js';

async function run() {
  if (!supabase) return;

  const { data: auditLogs } = await supabase.from('signal_audit_log').select('*').limit(3);
  console.log("=== signal_audit_log ===");
  console.log(JSON.stringify(auditLogs, null, 2));

  const { data: signalsTable } = await supabase.from('signals').select('*').limit(3);
  console.log("\n=== signals ===");
  console.log(JSON.stringify(signalsTable, null, 2));

  const { data: closedTrades } = await supabase.from('signals')
    .select('*')
    .in('result', ['WIN', 'LOSS'])
    .order('timestamp', { ascending: false })
    .limit(20);
  console.log("\n=== Last 20 closed trades ===");
  console.log(JSON.stringify(closedTrades, null, 2));

  const { count: winCount } = await supabase.from('signals').select('*', { count: 'exact', head: true }).eq('result', 'WIN');
  console.log("\n=== WIN Count: " + winCount + " ===");

  const { count: lossCount } = await supabase.from('signals').select('*', { count: 'exact', head: true }).eq('result', 'LOSS');
  console.log("=== LOSS Count: " + lossCount + " ===");
}
run().then(() => process.exit(0));
