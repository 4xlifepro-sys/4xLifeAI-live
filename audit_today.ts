import { supabase } from './server/supabase.js';

async function audit() {
  const { data: signals, error: sigErr } = await supabase
    .from('signals')
    .select('*')
    .gte('created_at', '2026-06-25T00:00:00Z')
    .order('created_at', { ascending: false });

  console.log(`Signals since yesterday: ${signals?.length}`);
  if (signals) {
      signals.forEach(s => console.log(s.pair, s.direction, s.created_at, s.status, s.tier));
  }
  
  const { data: audits, error: auditErr } = await supabase
    .from('signal_audit_log')
    .select('*')
    .gte('generated_at', '2026-06-26T00:00:00Z')
    .order('generated_at', { ascending: false });
    
  console.log(`Audits today: ${audits?.length}`);
  
  const rejected = audits?.filter(a => a.tier === 'Reject') || [];
  const accepted = audits?.filter(a => a.tier !== 'Reject') || [];
  console.log(`Accepted audits today: ${accepted.length}`);
  console.log(`Rejected audits today: ${rejected.length}`);
  
  const reasons: any = {};
  rejected.forEach(r => {
      const reason = r.rejection_reason || 'UNKNOWN';
      reasons[reason] = (reasons[reason] || 0) + 1;
  });
  console.log("Rejection reasons today:", reasons);
}

audit();
