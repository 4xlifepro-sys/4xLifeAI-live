import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '', 
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
  console.log('--- 1. FIRING A SIGNAL ---');
  // Simulate Scanner inserting into signal_audit_log
  const mockSignal = {
    pair: 'TEST_BTCUSD',
    direction: 'BUY',
    tier: 'Elite',
    status: 'VALID',
    entry: 65000.5,
    sl: 64000.0,
    tp1: 66000.0,
    raw_4h_open: 64500,
    raw_4h_close: 65500,
    confidence_score: 95
  };
  
  const { error: insertAuditErr } = await supabase.from('signal_audit_log').insert([mockSignal]);
  console.log('Audit Log Insert:', insertAuditErr || 'SUCCESS');
  
  // Simulate App generating signal which triggers database notifications
  const { data: triggerData, error: insertSignalErr } = await supabase.from('signals').insert([{
    pair: 'TEST_BTCUSD',
    direction: 'BUY',
    tier: 'Elite',
    entry: 65000.5,
    sl: 64000.0,
  }]).select('id');
  console.log('Signal Table Insert:', insertSignalErr || 'SUCCESS');

  console.log('\n--- 2. VERIFYING AUDIT LOG ---');
  const { data: auditData } = await supabase.from('signal_audit_log').select('*').eq('pair', 'TEST_BTCUSD').order('generated_at', { ascending: false }).limit(1);
  console.log(auditData?.[0]);

  console.log('\n--- 3. VERIFYING NOTIFICATIONS (TRIGGERED BY SIGNAL) ---');
  // Wait 1 second for triggers if necessary (should be synchronous in Postgres though)
  const { data: notifData } = await supabase.from('notifications').select('*').eq('type', 'SIGNAL').like('message', '%TEST_BTCUSD%').order('created_at', { ascending: false }).limit(1);
  console.log(notifData?.[0]);
  
  console.log('\n--- 4. CLEANUP (DELETING TEST ROWS) ---');
  await supabase.from('signal_audit_log').delete().eq('pair', 'TEST_BTCUSD');
  if (triggerData?.[0]?.id) {
    await supabase.from('signals').delete().eq('id', triggerData[0].id);
  }
}
run();
