// One-off maintenance script: wipe ALL signal history to start fresh.
// Deletes every row from the `signals` table (and dependent user_signal_views
// / notifications if present). Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// in the environment (same as production).
//
// Run:  npx tsx server/clean-all-signals.ts
import { supabase } from './supabase.js';

async function wipeTable(table: string) {
  if (!supabase) return;
  // Delete every row. Use a filter that always matches (id is not null).
  const { error } = await supabase.from(table).delete().not('id', 'is', null);
  if (error) {
    console.log(`  - ${table}: skipped (${error.message})`);
  } else {
    console.log(`  - ${table}: cleared`);
  }
}

async function main() {
  if (!supabase) {
    console.error('Supabase not connected. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const { count: before } = await supabase
    .from('signals')
    .select('*', { count: 'exact', head: true });
  console.log(`Signals before cleanup: ${before ?? 'unknown'}`);

  console.log('Wiping signal history...');
  // Order matters if there are FK dependencies: clear children first.
  await wipeTable('user_signal_views');
  await wipeTable('notifications');
  await wipeTable('signals');

  const { count: after } = await supabase
    .from('signals')
    .select('*', { count: 'exact', head: true });
  console.log(`Signals after cleanup: ${after ?? 0}`);
  console.log('Done. Dashboard, Today\'s Signals, win rate, and history are now fresh.');
}

main().catch((e) => {
  console.error('Cleanup failed:', e);
  process.exit(1);
});
