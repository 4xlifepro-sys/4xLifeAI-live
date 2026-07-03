import { supabase } from './server/supabase.js';

async function audit() {
  const { data, error } = await supabase
    .from('signal_audit_log')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error("Error fetching logs:", error);
    return;
  }

  console.log(`Total setups in last 500 records: ${data.length}`);
  
  if (data.length > 0) {
      console.log(`Latest record timestamp: ${data[0].generated_at}`);
      console.log(`Oldest record timestamp: ${data[data.length-1].generated_at}`);
  }

  const accepted = data.filter(d => d.tier !== 'Reject');
  console.log(`Accepted signals: ${accepted.length}`);

  const rejected = data.filter(d => d.tier === 'Reject');
  console.log(`Rejected signals: ${rejected.length}`);

  const reasons: any = {};
  for (const r of rejected) {
    const reason = r.rejection_reason || 'UNKNOWN';
    reasons[reason] = (reasons[reason] || 0) + 1;
  }

  console.log("Rejection breakdown:", reasons);
  
  // also get stats
  const { data: stats } = await supabase.from('scanner_stats').select('*').limit(1);
  console.log("Scanner Stats:", stats);
}

audit();
