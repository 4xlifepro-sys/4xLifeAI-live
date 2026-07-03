import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data: signals, error } = await supabase
    .from('signals')
    .select('pair, result, score, confidence, tier, pips_won, pips_lost, created_at')
    .in('status', ['CLOSED', 'LOSS']) // 'CLOSED' usually means WIN or BREAKEVEN
    .not('result', 'is', null)
    .not('result', 'eq', 'OPEN')
    .not('result', 'eq', 'PENDING')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !signals) {
    console.log("Error:", error);
    return;
  }

  console.log("--- CONSISTENCY CHECK: LAST 10 CLOSED SIGNALS ---");
  for (const s of signals) {
     const confStr = s.confidence ? `${s.confidence}%` : `${(s.score*10).toFixed(0)}%`;
     const outcome = s.result;
     const pips = s.result === 'WIN' || s.result === 'PARTIAL WIN' ? `+${s.pips_won}` : `-${s.pips_lost}`;
     const tierStr = s.tier || 'Unknown';
     console.log(`Pair: ${s.pair.padEnd(8)} | Tier: ${tierStr.padEnd(8)} | Confidence: ${confStr.padEnd(4)} | Outcome: ${outcome.padEnd(10)} | Pips: ${pips}`);
  }
}

run();
