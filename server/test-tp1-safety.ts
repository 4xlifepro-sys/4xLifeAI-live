import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testTP1Hit() {
  console.log('=== Simulating TP1 hit scenario ===\n');

  // Insert a fake GBPNZD signal
  const { data, error } = await supabaseAdmin
    .from('signals')
    .insert({
      pair: 'GBPNZD_TEST',
      direction: 'SELL',
      entry_price: 2.3267,
      original_sl: 2.3277,
      sl: 2.3277,
      tp1: 2.3252,
      tp2: 2.3237,
      tp3: 2.3217,
      confidence: 70,
      status: 'LIVE',
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error('Insert failed:', error.message);
    return;
  }

  console.log('Created test signal:', data.id);

  // Simulate the OLD bug: TP1 hit moves SL to entry in DB
  const { error: updateError } = await supabaseAdmin
    .from('signals')
    .update({
      sl: 2.3267, // corrupted to entry
      tp1_hit_at: new Date().toISOString(),
      status: 'TP1_HIT',
    })
    .eq('id', data.id);

  if (updateError) {
    console.log('\n✅ DATABASE TRIGGER BLOCKED THE CORRUPTION:', updateError.message);
  } else {
    console.log('\n❌ Database allowed corruption — trigger may not be installed');
  }

  // Cleanup
  await supabaseAdmin.from('signals').delete().eq('id', data.id);
  console.log('\nCleaned up test signal');
}

testTP1Hit().catch(console.error);
