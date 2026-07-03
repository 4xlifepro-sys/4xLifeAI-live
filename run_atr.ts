import { fetchCandles } from './server/twelvedata-scanner.js';
import { getPipMultiplier } from './server/engine.js';

function calculateATR(candles: any[], period: number) {
  const atr = [];
  let sumTr = 0;

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      atr.push(null);
      continue;
    }
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    const trueRange = Math.max(tr1, tr2, tr3);

    if (i < period) {
      sumTr += trueRange;
      atr.push(null);
      if (i === period - 1) {
        atr[i] = sumTr / period;
      }
    } else {
      const prevAtr = atr[i - 1];
      const currentAtr = (prevAtr! * (period - 1) + trueRange) / period;
      atr.push(currentAtr);
    }
  }
  return atr;
}

const run = async () => {
    const pairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'];
    console.log('PAIR | CURRENT_ATR_PIPS | MIN_REQUIRED_ATR_PIPS | RATIO');
    for (const pair of pairs) {
       const candles = await fetchCandles(pair, '5min');
       if (!candles || candles.length < 15) {
          console.log(`${pair} | ERROR FETCHING CANDLES`);
          continue;
       }
       const atrValues = calculateATR(candles, 14);
       const currentAtr = atrValues[atrValues.length - 1];
       
       const pipsMultiplier = getPipMultiplier(pair);
       const isVolatileForex = pair.includes('GBP') || pair.includes('JPY') || pair.includes('NZD') || pair.includes('CAD');
       
       let requiredPips = isVolatileForex ? 8 : 4;
       let currentAtrPips = currentAtr / pipsMultiplier;
       let ratio = currentAtrPips / requiredPips;

       console.log(`${pair.padEnd(6, ' ')} | ${currentAtrPips.toFixed(2)} pips | ${requiredPips} pips | ${(ratio * 100).toFixed(0)}%`);
       
       // Sleep 1s to avoid rate limit
       await new Promise(r => setTimeout(r, 1000));
    }
}
run();
