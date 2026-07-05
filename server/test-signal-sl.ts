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

    for (let i = m5Candles.length - 1; i >= Math.max(0, m5Candles.length - 5); i--) {
      const slice = m5Candles.slice(0, i + 1);
      const h4Slice = h4Candles.slice(0, h4Candles.length);

      const signal = detectSignalV2(pair, h4Slice, slice);

      if (signal) {
        const slDistance = Math.abs(signal.entry - signal.sl);
        const pipMult = pair.includes('JPY') ? 0.01
          : pair.includes('XAU') ? 0.1
          : pair.includes('XAG') ? 0.01
          : pair.includes('BTC') || pair.includes('ETH') ? 1
          : 0.0001;
        const slDistancePips = slDistance / pipMult;

        let floorLabel = '';
        let floorPipsVal = 0;
        if (pair.includes('BTC')) { floorLabel = '$250'; floorPipsVal = 250 / pipMult; }
        else if (pair.includes('ETH')) { floorLabel = '$15'; floorPipsVal = 15 / pipMult; }
        else if (pair.includes('XAU')) { floorLabel = '$12'; floorPipsVal = 12 / pipMult; }
        else if (pair.includes('XAG')) { floorLabel = '$0.50'; floorPipsVal = 0.50 / pipMult; }
        else if (pair.includes('JPY')) { floorLabel = '8 pips'; floorPipsVal = 8; }
        else { floorLabel = '5 pips'; floorPipsVal = 5; }

        const floorTriggered = slDistancePips <= floorPipsVal + 0.5;

        console.log(`\nSignal detected at candle ${i}:`);
        console.log(`  Entry: ${signal.entry}`);
        console.log(`  SL: ${signal.sl}`);
        console.log(`  SL Distance: ${slDistance} (${slDistancePips.toFixed(1)} pips)`);
        console.log(`  Floor: ${floorLabel} (${floorPipsVal} pips equivalent)`);
        console.log(`  Floor triggered: ${floorTriggered ? 'YES (ATR was below floor)' : 'NO (ATR exceeded floor)'}`);
        console.log(`  TP1: ${signal.tp1}`);
        console.log(`  TP2: ${signal.tp2}`);
        console.log(`  TP3: ${signal.tp3}`);
        console.log(`  Confidence: ${signal.confidence}%`);
        console.log(`  Reason: ${signal.reason}`);

        return;
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
