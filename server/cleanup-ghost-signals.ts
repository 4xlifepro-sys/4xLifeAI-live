import { supabase } from './supabase.js';
import { fetchCandles } from './live-market-feed.js';

interface Signal {
  id: string;
  pair: string;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  direction: string;
  status: string;
  timestamp: string;
  created_at?: string;
}

async function getCurrentPrice(pair: string): Promise<number | null> {
  try {
    const candles = await fetchCandles(pair, '5min');
    if (!candles || candles.length === 0) return null;
    return candles[candles.length - 1].close;
  } catch (e: any) {
    console.log(`  ⚠ Failed to fetch price for ${pair}: ${e.message}`);
    return null;
  }
}

function classify(signal: Signal, currentPrice: number): 'A' | 'B' | 'C' {
  const dir = signal.direction?.toUpperCase() || 'LONG';
  const isLong = dir === 'LONG' || dir === 'BUY';

  if (isLong) {
    if (currentPrice >= signal.tp1) return 'A';
    if (currentPrice <= signal.sl) return 'B';
  } else {
    if (currentPrice <= signal.tp1) return 'A';
    if (currentPrice >= signal.sl) return 'B';
  }

  return 'C';
}

async function main() {
  if (!supabase) {
    console.error('❌ Supabase not connected');
    return;
  }

  console.log('🧹 GHOST SIGNAL CLEANUP\n');

  // Fetch all ACTIVE signals
  const { data: activeSignals, error } = await supabase
    .from('signals')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Failed to fetch signals:', error.message);
    return;
  }

  if (!activeSignals || activeSignals.length === 0) {
    console.log('✅ No active signals found. Dashboard is clean.');
    return;
  }

  console.log(` Found ${activeSignals.length} active signals to review\n`);

  const scenarios = { A: 0, B: 0, C: 0 };
  const ghostsToClean: Signal[] = [];

  for (const sig of activeSignals) {
    const signal = sig as Signal;
    const currentPrice = await getCurrentPrice(signal.pair);

    if (!currentPrice) {
      console.log(`⚠ ${signal.pair} - No price data, skipping`);
      continue;
    }

    const scenario = classify(signal, currentPrice);
    scenarios[scenario]++;

    const age = Date.now() - new Date(signal.timestamp || signal.created_at || Date.now()).getTime();
    const ageHours = Math.round(age / 3600000);
    const ageMins = Math.round(age / 60000);
    const ageLabel = ageHours > 24 ? `${Math.round(ageHours / 24)}d` : ageHours > 0 ? `${ageHours}h` : `${ageMins}m`;

    const emoji = scenario === 'A' ? '✅' : scenario === 'B' ? '❌' : '👻';
    const label = scenario === 'A' ? 'WILL SELF-CORRECT' : scenario === 'B' ? 'WILL CLOSE AS LOSS' : 'GHOST - STUCK';

    console.log(`${emoji} ${signal.pair} | ${signal.direction} @ ${signal.entry} | SL: ${signal.sl} | TP1: ${signal.tp1} | Current: ${currentPrice} | Age: ${ageLabel} | ${label}`);

    if (scenario === 'C') {
      ghostsToClean.push(signal);
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n Summary:`);
  console.log(`   ✅ Scenario A (self-correct): ${scenarios.A}`);
  console.log(`   ❌ Scenario B (will close):   ${scenarios.B}`);
  console.log(`   👻 Scenario C (ghosts):      ${scenarios.C}`);

  if (ghostsToClean.length === 0) {
    console.log('\n✅ No ghosts to clean. All done!');
    return;
  }

  console.log(`\n Cleaning up ${ghostsToClean.length} ghost signals...`);

  for (const ghost of ghostsToClean) {
    const { error: updateError } = await supabase
      .from('signals')
      .update({
        is_active: false,
        status: 'CANCELLED',
        result: 'MISSED',
        closed_at: new Date().toISOString()
      })
      .eq('id', ghost.id);

    if (updateError) {
      console.log(`  ⚠ Failed to close ${ghost.pair} (${ghost.id}): ${updateError.message}`);
    } else {
      console.log(`  ✅ Closed ghost: ${ghost.pair} ${ghost.direction} @ ${ghost.entry}`);
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n✅ Cleanup complete. Closed ${ghostsToClean.length} ghost signals.`);
}

main().catch(console.error);
