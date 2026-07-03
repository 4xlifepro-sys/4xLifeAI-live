import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data: signals, error } = await supabase
    .from('signals')
    .select('*')
    .eq('result', 'LOSS')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !signals) {
    console.log("Error:", error);
    return;
  }

  if (signals.length === 0) {
     console.log("No losing signals found.");
     return;
  }

  let totalLossPips = 0;
  for (const s of signals) {
     const pipsMultiplier = (s.pair.includes('JPY') || s.pair.includes('XAG')) ? 0.01 : 
                            (s.pair.includes('XAU') ? 0.1 : 
                            (s.pair === 'BTCUSD' ? 1.0 : 0.0001));
     
     const slDistance = Math.abs(s.entry_price - s.sl) / pipsMultiplier;
     totalLossPips += slDistance;
     console.log(`Pair: ${s.pair}, Entry: ${s.entry_price}, SL: ${s.sl}, SL Pips: ${slDistance.toFixed(1)}`);
  }

  console.log(`\nAverage SL pips on last ${signals.length} losses: ${(totalLossPips / signals.length).toFixed(1)} pips`);
}

run();
