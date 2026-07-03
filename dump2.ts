import { supabase } from './server/supabase.js';

async function run() {
  if (!supabase) return;

  const { data: closedTrades, error } = await supabase.from('signals')
    .select('*')
    .in('result', ['WIN', 'LOSS'])
    .order('created_at', { ascending: false })
    .limit(20);
  console.log("\n=== Last 20 closed trades ===");
  if (error) console.log("error", error);
  console.log(JSON.stringify(closedTrades, null, 2));

}
run().then(() => process.exit(0));
