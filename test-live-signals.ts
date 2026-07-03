import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  console.log("--- LATEST GENERATED SIGNALS ---");
  const { data: signals } = await supabase
    .from('signals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (signals) {
    for (const s of signals) {
      const pipsMultiplier = (s.pair.includes('JPY') || s.pair.includes('XAG')) ? 0.01 : 
                             (s.pair.includes('XAU') ? 0.1 : 
                             (s.pair === 'BTCUSD' ? 1.0 : 0.0001));
                             
      const slPips = Math.abs(s.entry_price - s.sl) / pipsMultiplier;
      console.log(`Pair: ${s.pair.padEnd(8)} | Dir: ${s.direction.padEnd(5)} | Entry: ${s.entry_price} | SL: ${s.sl} | Risk: ${slPips.toFixed(1)} pips | Time: ${s.created_at}`);
    }
  }

  console.log("\n--- RECENT AUDIT LOGS ---");
  const { data: recentLogs } = await supabase
    .from('signal_audit_log')
    .select('id, pair, direction, rejection_reason, created_at, status')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (recentLogs && recentLogs.length > 0) {
    for (const l of recentLogs) {
      console.log(`Time: ${l.created_at} | Pair: ${l.pair} | Status: ${l.status} | Reject: ${l.rejection_reason}`);
    }
  }
}

run();
