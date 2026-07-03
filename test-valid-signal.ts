import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '', 
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || ''
);

async function mockScan(signalData: any) {
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  let isDuplicate = false;

  console.log(`[SCANNER] Received new VALID signal for ${signalData.pair} at entry ${signalData.entry}`);

  // Deduplication logic check (mocking what scanner.ts does)
  const { data } = await supabase
    .from('signal_audit_log')
    .select('entry')
    .eq('pair', signalData.pair)
    .eq('direction', signalData.direction)
    .eq('status', 'VALID')
    .gte('generated_at', thirtyMinsAgo);

  if (data && data.length > 0) {
    isDuplicate = data.some(d => Math.abs((d.entry || 0) - signalData.entry) < 0.00001);
  }

  if (isDuplicate) {
    console.log(`[DEDUP] Signal is a DUPLICATE matching previous entry price inside 30-min window. Skipping...`);
    return { status: 'DUPLICATE' };
  } else {
    console.log(`[DEDUP] Signal is GENUINELY NEW. Proceeding to insert...`);
    
    // 1. Insert to Audit Log
    const { error: e1 } = await supabase.from('signal_audit_log').insert([{
        pair: signalData.pair,
        status: 'VALID',
        tier: 'Elite',
        direction: signalData.direction,
        entry: signalData.entry,
        sl: signalData.sl,
        tp1: signalData.tp1,
        confidence_score: 95,
        generated_at: new Date().toISOString()
    }]);
    
    if (e1) console.error("Audit Insert Error:", e1);

    // 2. Telegram Alert Simulation
    console.log(`[TELEGRAM] >>> Sending Notification to channel for ${signalData.pair} BUY @ ${signalData.entry}`);
    
    return { status: 'INSERTED_AND_ALERTED' };
  }
}

async function run() {
  console.log('\n========= TRIGGERING REAL VALID SIGNAL EVENT =========');
  
  const mockValidSignal = {
    pair: 'TEST_ETHUSD',
    direction: 'LONG',
    entry: 3500.25,
    sl: 3450.00,
    tp1: 3600.00
  };

  // FIRST TIME: Should be GENUINELY NEW
  console.log('\n--- Run 1 ---');
  await mockScan(mockValidSignal);
  
  // WAIT 2 SECONDS
  await new Promise(r => setTimeout(r, 2000));

  // SECOND TIME: Next loop fires perfectly identical signal inside 30 mins
  console.log('\n--- Run 2 (Simulating Next Scanner Loop) ---');
  await mockScan(mockValidSignal);
  
  // Let's check DB Proof
  console.log('\n--- Querying DB to Verify Exactly ONE Record Exists ---');
  const { data } = await supabase.from('signal_audit_log').select('pair, entry, generated_at').eq('pair', 'TEST_ETHUSD');
  console.log(data);

  // CLEANUP
  await supabase.from('signal_audit_log').delete().eq('pair', 'TEST_ETHUSD');
}
run();
