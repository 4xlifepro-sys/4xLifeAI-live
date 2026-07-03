import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.VITE_SUPABASE_ANON_KEY || '');

async function run() {
  const signalId = randomUUID();
  console.log("=== TP1 HIT ===");
  console.log({
    id: signalId, pair: "BTCUSD", direction: "LONG", 
    entry: 60000, sl: 59000, tp1: 61000, tp2: 62000, tp3: 63000,
    status: 'TP1 HIT', is_active: true, tp1_hit_at: new Date().toISOString()
  });

  console.log("=== TP2 HIT ===");
  console.log({
    id: signalId, pair: "BTCUSD", direction: "LONG", 
    entry: 60000, sl: 59000, tp1: 61000, tp2: 62000, tp3: 63000,
    status: 'TP2 HIT', is_active: true, tp1_hit_at: new Date().toISOString(), tp2_hit_at: new Date().toISOString()
  });

  console.log("=== TP3 HIT (FINAL WIN) ===");
  console.log({
    id: signalId, pair: "BTCUSD", direction: "LONG", 
    entry: 60000, sl: 59000, tp1: 61000, tp2: 62000, tp3: 63000,
    status: 'CLOSED', is_active: false, result: 'WIN', pips_won: 3000, closed_at: new Date().toISOString(),
    tp1_hit_at: new Date().toISOString(), tp2_hit_at: new Date().toISOString(), tp3_hit_at: new Date().toISOString()
  });

  console.log("=== SL HIT (LOSS) ===");
  console.log({
    id: randomUUID(), pair: "EURUSD", direction: "SHORT", 
    entry: 1.1000, sl: 1.1050, tp1: 1.0950, tp2: 1.0900, tp3: 1.0800,
    status: 'CLOSED', is_active: false, result: 'LOSS', pips_lost: 50, closed_at: new Date().toISOString()
  });
}

run();
