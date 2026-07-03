import { supabase } from './server/supabase.js';

async function checkSchema() {
  const insertPayload: any = {
      id: 'test-id-1234',
      pair: 'EURUSD',
      direction: 'LONG',
      bias: 'BULLISH',
      score: 10,
      confidence: 100,
      tier: 'Good',
      entry_price: 1.05,
      sl: 1.04,
      original_sl: 1.04,
      tp1: 1.06,
      tp2: 1.07,
      tp3: 1.08,
      created_at: new Date().toISOString(),
      status: 'ACTIVE',
      is_active: true,
      result: 'OPEN',
      pips_won: 0,
      pips_lost: 0
  };
  const { data, error } = await supabase.from('signals').insert([insertPayload]).select('id');
  console.log("Insert result:", error ? error.message : "Success");
}
checkSchema();
