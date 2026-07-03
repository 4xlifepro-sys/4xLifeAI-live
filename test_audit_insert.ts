import { supabase } from './server/supabase.js';

async function checkSchema() {
  const { data, error } = await supabase.from('signal_audit_log').insert([{
                 id: 'test-id-1234',
                 pair: 'EURUSD',
                 status: 'REJECTED',
                 tier: 'Reject',
                 direction: 'LONG',
                 momentum_score: 100,
                 volatility_score: 100,
                 final_score: 100
  }]).select('*');
  console.log("Insert result:", error ? error.message : "Success");
}
checkSchema();
