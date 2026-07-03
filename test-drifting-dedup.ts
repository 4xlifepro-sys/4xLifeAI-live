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

  console.log(`[SCANNER] Received new signal for ${signalData.pair} at entry ${signalData.entry} (SL: ${signalData.sl})`);

  // Deduplication logic check (mocking what we just updated in scanner.ts)
  const { data } = await supabase
    .from('signal_audit_log')
    .select('entry, sl')
    .eq('pair', signalData.pair)
    .eq('direction', signalData.direction)
    .eq('status', 'VALID')
    .gte('generated_at', thirtyMinsAgo);

  if (data && data.length > 0) {
    isDuplicate = data.some(d => Math.abs((d.entry || 0) - signalData.entry) < 0.00001 || Math.abs((d.sl || 0) - signalData.sl) < 0.00001);
  }

  if (isDuplicate) {
    console.log(`[DEDUP] Signal blocked: Found identical entry or stop-loss within 30-min window.`);
    return { status: 'DUPLICATE' };
  } else {
    console.log(`[DEDUP] Signal is GENUINELY NEW. Proceeding to insert...`);
    
    await supabase.from('signal_audit_log').insert([{
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

    return { status: 'INSERTED' };
  }
}

async function run() {
  console.log('========= TESTING DRIFTING ENTRY DEDUP LOGIC =========');
  
  // ADAUSD at 03:25:11 (First Signal)
  const signal1 = {
    pair: 'ADAUSD_TEST',
    direction: 'LONG',
    entry: 0.163109,
    sl: 0.16185,
    tp1: 0.165000 
  };

  // ADAUSD at 03:25:52 (Second Signal - 41s later, drifted entry, same SL)
  const signal2 = {
    pair: 'ADAUSD_TEST',
    direction: 'LONG',
    entry: 0.162925,
    sl: 0.16185,
    tp1: 0.165000 
  };

  console.log('\n--- Run 1 (03:25:11) ---');
  await mockScan(signal1);
  
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- Run 2 (03:25:52 - Entry Drifted!) ---');
  await mockScan(signal2);

  // CLEANUP
  await supabase.from('signal_audit_log').delete().eq('pair', 'ADAUSD_TEST');
}
run();
