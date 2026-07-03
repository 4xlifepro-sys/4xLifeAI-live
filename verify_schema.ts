import { supabase } from './server/supabase.js';

async function check() {
  const tables = ['scanner_stats', 'active_opportunities', 'trades', 'signals', 'signal_audit_log'];
  
  for (const t of tables) {
      const { data, error } = await supabase.from(t).select('*').limit(1);
      if (error) {
          console.log(`Table ${t}: ERROR - ${error.message}`);
      } else {
          console.log(`Table ${t}: OK`);
          
          if (t === 'signals') {
             const { data: d2, error: e2 } = await supabase.from('signals').select('original_sl').limit(1);
             console.log(`signals.original_sl: ${e2 ? e2.message : 'OK'}`);
          }
          if (t === 'signal_audit_log') {
             const { data: d2, error: e2 } = await supabase.from('signal_audit_log').select('final_score').limit(1);
             console.log(`signal_audit_log.final_score: ${e2 ? e2.message : 'OK'}`);
          }
      }
  }
}
check();
