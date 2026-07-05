import { detectSignalV2 } from './engine2.js';
import { fetchCandles } from './live-market-feed.js';

async function testSignal(pair: string) {
  console.log(`\n===== Testing ${pair} =====`);
  
  try {
    const m5Candles = await fetchCandles(pair, '5min');
    const h4Candles = await fetchCandles(pair, '4h');
    
    if (!m5Candles || !h4Candles) {
      console.log(`No data for ${pair}`);
      return;
    }

    console.log(`M5 candles: ${m5Candles.length}`);
    console.log(`H4 candles: ${h4Candles.length}`);

    // Generate a few signals by testing different candles
    for (let i = m5Candles.length - 1; i >= Math.max(0, m5Candles.length - 5); i--) {
      const slice = m5Candles.slice(0, i + 1);
      const h4Slice = h4Candles.slice(0, h4Candles.length);
      
      const signal = detectSignalV2(pair, h4Slice, slice);
      
      if (signal) {
        const slDistance = Math.abs(signal.entry - signal.sl);
        const isCrypto = ['BTC', 'ETH'].some(c => pair.includes(c));
        const floorPips = isCrypto ? (pair.includes('BTC') ? 250 : 15) : 0;
        const floorTriggered = slDistance <= floorPips + 1; // +1 for rounding
        
        console.log(`\nSignal detected at candle ${i}:`);
        console.log(`  Entry: ${signal.entry.toFixed(2)}`);
        console.log(`  SL: ${signal.sl.toFixed(2)}`);
        console.log(`  SL Distance: ${slDistance.toFixed(2)} ${isCrypto ? 'dollars' : 'price units'}`);
        console.log(`  Floor: ${floorPips} ${isCrypto ? 'dollars' : 'pips'}`);
        console.log(`  Floor triggered: ${floorTriggered ? 'YES' : 'NO'}`);
        console.log(`  TP1: ${signal.tp1.toFixed(2)}`);
        console.log(`  Confidence: ${signal.confidence}%`);
        console.log(`  Reason: ${signal.reason}`);
        
        return; // Show first signal found
      }
    }
    
    console.log(`No signal found in last 5 candles for ${pair}`);
  } catch (e: any) {
    console.error(`Error testing ${pair}:`, e.message);
  }
}

async function main() {
  console.log('SIGNAL SL TEST - Verifying floor logic');
  
  await testSignal('BTCUSD');
  await testSignal('ETHUSD');
  await testSignal('XAUUSD');
  await testSignal('EURUSD');
}

main().catch(console.error);
