import { supabase } from './server/supabase.js';

async function test() {
  console.log("Creating a mock ACTIVE signal in signal_audit_log...");
  const mockId = 'a1234567-89ab-cdef-0123-456789abcdef';
  
  // Clean up any old ones
  await supabase.from('signal_audit_log').delete().eq('id', mockId);

  // Insert mock
  const { error: insertErr } = await supabase.from('signal_audit_log').insert([{
    id: mockId,
    pair: 'TEST/USD',
    status: 'ACTIVE',
    direction: 'LONG',
    entry: 1.0,
    sl: 0.9,
    tp1: 1.1,
    tp2: 1.2,
    tp3: 1.3,
    tier: 'Strong',
    generated_at: new Date().toISOString()
  }]);

  if (insertErr) {
    console.error("Insert error:", insertErr);
    return;
  }
  
  console.log("Mock ACTIVE signal inserted successfully.");

  // Simulate TP1 HIT payload that was failing before
  const updatePayload: any = { 
    status: 'TP1 HIT',
    tp1_hit_at: new Date().toISOString()
  };

  const safePayload = { ...updatePayload };
  if ('tp1_hit_at' in safePayload) delete safePayload['tp1_hit_at'];
  delete safePayload.closed_at;
  delete safePayload.is_active;
  delete safePayload.result;
  delete safePayload.pips_won;
  delete safePayload.pips_lost;

  const { error: updateErr } = await supabase.from('signal_audit_log').update(safePayload).eq('id', mockId);
  
  if (updateErr) {
    console.error("Update error:", updateErr);
  } else {
    console.log("Update to TP1 HIT successful (no error).");
  }

  // Verify status in DB
  const { data } = await supabase.from('signal_audit_log').select('status').eq('id', mockId).single();
  console.log("Persisted Status in DB:", data?.status);

  // Cleanup
  await supabase.from('signal_audit_log').delete().eq('id', mockId);
}

test();
