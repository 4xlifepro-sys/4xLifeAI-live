import { supabase } from './server/supabase.js';

async function audit() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('signal_audit_log')
    .select('*')
    .gte('generated_at', startOfDay.toISOString());

  if (error) {
    console.error("Error fetching logs:", error);
    return;
  }

  console.log(`Total setups today: ${data.length}`);
  
  const accepted = data.filter(d => d.tier !== 'Reject');
  console.log(`Accepted signals: ${accepted.length}`);

  const rejected = data.filter(d => d.tier === 'Reject');
  console.log(`Rejected signals: ${rejected.length}`);

  const reasons = {};
  for (const r of rejected) {
    const reason = r.rejection_reason || 'UNKNOWN';
    reasons[reason] = (reasons[reason] || 0) + 1;
  }

  console.log("Rejection breakdown:", reasons);
  
  const regimeStats = { TRENDING: 0, CHOP: 0, VOLATILE: 0, UNKNOWN: 0 };
  for (const r of data) {
      if (r.rejection_reason === 'REJECT_CHOP') regimeStats.CHOP++;
      else if (r.rejection_reason === 'REJECT_VOLATILE') regimeStats.VOLATILE++;
      else if (r.status === 'ACTIVE' || !r.rejection_reason?.includes('CHOP') && !r.rejection_reason?.includes('VOLATILE')) regimeStats.TRENDING++;
      else regimeStats.UNKNOWN++;
  }
  console.log("Regime Breakdown (Estimate based on rejections and accepts):", regimeStats);
}

audit();
