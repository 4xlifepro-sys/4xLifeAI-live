import { supabase } from './server/supabase.js';

async function check() {
  if (!supabase) return;

  const { count: auditCount } = await supabase.from('signal_audit_log').select('*', { count: 'exact', head: true });
  console.log('audit log total count:', auditCount);

  const { count: resultsCount } = await supabase.from('signal_results').select('*', { count: 'exact', head: true });
  console.log('results total count:', resultsCount);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count: validToday } = await supabase.from('signal_audit_log').select('*', { count: 'exact', head: true })
    .gte('generated_at', startOfDay.toISOString())
    .neq('status', 'REJECTED');
  console.log('valid signals today:', validToday);

  const { count: activeCount } = await supabase.from('signal_results').select('*', { count: 'exact', head: true })
    .eq('result', 'PENDING');
  console.log('active actual signals (from signal_results):', activeCount);
}

check().then(() => process.exit(0));
