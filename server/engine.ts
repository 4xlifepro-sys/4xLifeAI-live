import { Candle, Signal } from '../src/types.js';
import crypto from 'crypto';

export const rejectionStats = {
   ATR_LOW: 0,
   EMA_FLAT: 0,
   MOMENTUM: 0,
   STOCHASTIC: 0,
   VWAP: 0,
   API_ERROR: 0,
   SPIKE: 0,
   COUNTER_TREND: 0,
   NO_PULLBACK: 0,
   STOP_DISTANCE: 0,
   LOW_CONFIDENCE: 0,
   ACTIVE_TRADE_EXISTS: 0
};

export function getPipMultiplier(pair: string) {
  if (pair.includes('JPY')) return 0.01;
  if (pair.includes('XAU')) return 0.1;
  if (pair.includes('XAG')) return 0.01;
  if (['BTCUSD','ETHUSD','SOLUSD',
       'XRPUSD','BNBUSD','ADAUSD',
       'LTCUSD','DOTUSD'].includes(pair)) return 1.0;
  return 0.0001;
}

export function filterClosedCandles(candles: Candle[], intervalMs: number): Candle[] {
  const now = Date.now();
  return candles.filter(c => {
    // API returns values like "2026-06-20 20:00:00" (which is the start time).
    const startMs = new Date(c.timestamp + 'Z').getTime();
    return (startMs + intervalMs) <= now;
  });
}

function calculateEMA(data: number[], period: number): (number | null)[] {
  const ema: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  let initialSMA = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    initialSMA += data[i];
    if (i < period - 1) ema.push(null);
  }
  
  if (data.length >= period) {
     initialSMA /= period;
     ema.push(initialSMA);
     
     for (let i = period; i < data.length; i++) {
       ema.push((data[i] - ema[i - 1]!) * multiplier + ema[i - 1]!);
     }
  }
  
  return ema;
}

function calculateStochastic(candles: Candle[], periodK: number, slowing: number, periodD: number) {
  const fastK: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i >= periodK - 1) {
      let highestHigh = candles[i].high;
      let lowestLow = candles[i].low;
      for (let j = 0; j < periodK; j++) {
        if (candles[i - j].high > highestHigh) highestHigh = candles[i - j].high;
        if (candles[i - j].low < lowestLow) lowestLow = candles[i - j].low;
      }
      const k = highestHigh === lowestLow ? 50 : ((candles[i].close - lowestLow) / (highestHigh - lowestLow)) * 100;
      fastK.push(k);
    } else {
      fastK.push(null);
    }
  }
  
  const slowK: (number | null)[] = [];
  let sumK = 0;
  let countK = 0;
  for (let i = 0; i < fastK.length; i++) {
     if (fastK[i] !== null) {
       sumK += fastK[i]!;
       countK++;
       if (countK > slowing) {
          sumK -= fastK[i - slowing]!;
          countK--;
       }
       if (countK === slowing) {
          slowK.push(sumK / slowing);
       } else {
          slowK.push(null);
       }
     } else {
       slowK.push(null);
     }
  }

  const slowD: (number | null)[] = [];
  let sumD = 0;
  let countD = 0;
  for (let i = 0; i < slowK.length; i++) {
     if (slowK[i] !== null) {
       sumD += slowK[i]!;
       countD++;
       if (countD > periodD) {
          sumD -= slowK[i - periodD]!;
          countD--;
       }
       if (countD === periodD) {
          slowD.push(sumD / periodD);
       } else {
          slowD.push(null);
       }
     } else {
       slowD.push(null);
     }
  }

  return { k: slowK, d: slowD };
}


function calculateATR(candles: Candle[], period: number): (number | null)[] {
  const atr: (number | null)[] = [];
  let trSum = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      atr.push(null);
      continue;
    }
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    // True range
    const tr = Math.max(
       high - low,
       Math.abs(high - prevClose),
       Math.abs(low - prevClose)
    );
    
    if (i <= period) {
       trSum += tr;
       if (i < period) {
           atr.push(null);
       } else {
           atr.push(trSum / period);
       }
    } else {
       const prevAtr = atr[i - 1]!;
       const currentAtr = (prevAtr * (period - 1) + tr) / period;
       atr.push(currentAtr);
    }
  }
  return atr;
}

function calculateVWAP(candles: Candle[]): (number | null)[] {
  const vwap: (number | null)[] = [];
  let cumTypicalPriceVolume = 0;
  let cumVolume = 0;
  
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const volume = 1; // Unweighted VWAP essentially for pure price action
    
    const date = new Date((c.timestamp.includes('Z') ? c.timestamp : c.timestamp + 'Z'));
    if (i === 0 || (date.getUTCHours() === 0 && date.getUTCMinutes() === 0) || date.getUTCHours() < new Date((candles[i-1].timestamp.includes('Z') ? candles[i-1].timestamp : candles[i-1].timestamp + 'Z')).getUTCHours() && date.getUTCHours() === 0) {
       cumTypicalPriceVolume = typicalPrice * volume;
       cumVolume = volume;
    } else {
       cumTypicalPriceVolume += typicalPrice * volume;
       cumVolume += volume;
    }
    vwap.push(cumTypicalPriceVolume / cumVolume);
  }
  return vwap;
}

export interface EngineResult {
  signal: Signal | null;
  scores: {
    strengthScore: number;
    momentumScore: number;
    atrScore: number;
    trendScore: number;
  } | null;
  regime: 'TRENDING' | 'CHOP' | 'VOLATILE' | 'UNKNOWN';
  regimeReason?: string;
}

export function detectTrendMomentumScannerV5(pair: string, htfRaw: Candle[], setupRaw: Candle[], entryTfRaw?: Candle[]): EngineResult {
  const APPROVED_PAIRS = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD',
    'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
    'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY', 'EURAUD',
    'EURNZD', 'GBPAUD', 'XAUUSD', 'XAGUSD', 'BTCUSD',
    'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD',
    'LTCUSD', 'DOTUSD'
  ];

  if (!APPROVED_PAIRS.includes(pair)) {
    return { signal: null, scores: null, regime: 'UNKNOWN' };
  }

  const htf = filterClosedCandles(htfRaw, 4 * 60 * 60 * 1000);
  const setup = filterClosedCandles(setupRaw, 5 * 60 * 1000);

  if (htf.length < 50 || setup.length < 50) return { signal: null, scores: null, regime: 'UNKNOWN' };

  // 1. 4H Trend Bias
  const htfCloses = htf.map(c => c.close);
  const htfEma50 = calculateEMA(htfCloses, 50);
  
  const lastHtfIdx = htf.length - 1;
  const last4H = htf[lastHtfIdx];
  const last4HEma = htfEma50[lastHtfIdx];
  
  let emaSlopePercent = 0;
  if (lastHtfIdx >= 5) {
     const pastEma = htfEma50[lastHtfIdx - 5];
     if (last4HEma !== null && pastEma !== null) {
         emaSlopePercent = Math.abs((last4HEma - pastEma) / last4HEma) * 100;
     }
  }

  if (last4HEma === null) return { signal: null, scores: null, regime: 'UNKNOWN' };

  let bias: 'BUY' | 'SELL' | 'NONE' = 'NONE';
  const isRising = emaSlopePercent > 0.01 && htfEma50[lastHtfIdx]! > htfEma50[lastHtfIdx - 5]!;
  const isFalling = emaSlopePercent > 0.01 && htfEma50[lastHtfIdx]! < htfEma50[lastHtfIdx - 5]!;

  if (last4H.close > last4HEma && isRising) {
      bias = 'BUY';
  } else if (last4H.close < last4HEma && isFalling) {
      bias = 'SELL';
  } else {
      bias = 'NONE';
  }

  // 2. 5M Indicators
  const setupCloses = setup.map(c => c.close);
  const ema50 = calculateEMA(setupCloses, 50);
  const stoch = calculateStochastic(setup, 8, 5, 3);
  const atr14 = calculateATR(setup, 14);
  const vwap = calculateVWAP(setup);

  const lastIdx = setup.length - 1;
  const current5M = setup[lastIdx];
  const prev5M = setup[lastIdx - 1];
  
  const currentEma = ema50[lastIdx];
  const prevEma = ema50[lastIdx - 1];
  
  const currentK = stoch.k[lastIdx];
  const currentD = stoch.d[lastIdx];
  
  const currentAtr = atr14[lastIdx];
  const currentVwap = vwap[lastIdx];

  if (currentEma === null || currentK === null || currentD === null || currentAtr === null || currentVwap === null) return { signal: null, scores: null, regime: 'UNKNOWN' };

  const currentCandleRange = Math.abs(current5M.high - current5M.low);
  const body = Math.abs(current5M.close - current5M.open);
  const momentumScore = currentCandleRange > 0 ? Math.min(100, Math.round((body / currentCandleRange) * 100)) : 0;

  const pipsMultiplier = getPipMultiplier(pair);
  const isCrypto = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'LTCUSD', 'DOTUSD'].includes(pair);
  const isVolatileForex = pair.includes('GBP') || pair.includes('JPY') || pair.includes('NZD') || pair.includes('CAD');
  
  let atrThreshold = 0;
  if (pair === 'XAUUSD') atrThreshold = 1.5;
  else if (pair === 'XAGUSD') atrThreshold = 0.08;
  else if (isCrypto) atrThreshold = current5M.close * 0.0035;
  else if (isVolatileForex) atrThreshold = 4 * pipsMultiplier;
  else atrThreshold = 2 * pipsMultiplier;

  const atrScore = atrThreshold > 0 ? Math.min(100, Math.round((currentAtr / atrThreshold) * 50)) : 0;
  
  const distanceToEma = Math.abs(current5M.close - currentEma);
  const trendScore = currentAtr > 0 ? Math.min(100, Math.round((distanceToEma / currentAtr) * 50)) : 0;

  let emaCrosses = 0;
  for (let i = Math.max(1, lastIdx - 20); i <= lastIdx; i++) {
     const prevClose = setup[i-1].close;
     const currentClose = setup[i].close;
     const prevEma = ema50[i-1]!;
     const currEma = ema50[i]!;
     
     if (prevEma !== null && currEma !== null) {
       if ((prevClose < prevEma && currentClose > currEma) || (prevClose > prevEma && currentClose < currEma)) {
           emaCrosses++;
       }
     }
  }

  let regime: 'TRENDING' | 'CHOP' | 'VOLATILE' | 'UNKNOWN' = 'UNKNOWN';
  let regimeReason = '';
  if (currentCandleRange > 3 * currentAtr) {
      regime = 'VOLATILE';
      regimeReason = `Candle range (${currentCandleRange.toFixed(5)}) > 3x ATR (${(3*currentAtr).toFixed(5)})`;
  } else if (emaSlopePercent < 0.015) {
      regime = 'CHOP';
      regimeReason = `Flat HTF EMA slope (${emaSlopePercent.toFixed(3)}%)`;
  } else if (emaCrosses >= 4) {
      regime = 'CHOP';
      regimeReason = `${emaCrosses} EMA crosses in last 20 candles`;
  } else {
      regime = 'TRENDING';
      regimeReason = `Healthy slope (${emaSlopePercent.toFixed(3)}%), clear direction`;
  }

  const strengthScore = Math.round(momentumScore * 0.5 + atrScore * 0.3 + trendScore * 0.2);
  const scores = { strengthScore, momentumScore, atrScore, trendScore, emaCrosses };

  if (bias === 'NONE') {
     return { signal: null, scores, regime, regimeReason };
  }

  const direction: 'LONG' | 'SHORT' = bias === 'BUY' ? 'LONG' : 'SHORT';
  
  let confidence = 70;
  let reason: string[] = [];
  let hardReject = '';
  
  const cb = {
    base: 70,
    trend: 0,
    ema: 0,
    pullback: 0,
    stochastic: 0,
    momentum: 0,
    structure: 0,
    atr: 0,
    vwap: 0,
    regime: 0,
    final: 70
  };

  if (regime === 'VOLATILE') {
      hardReject = 'REJECT_SPIKE';
  } else if (regime === 'CHOP') {
      hardReject = 'REJECT_EMA_FLAT';
  } else if (regime === 'TRENDING') {
      confidence += 5;
      cb.regime = 5;
      reason.push('+5 Trending Regime');
  }

  // Remove the old duplicate condition since regime handles it
  let atrValid = false;
  if (pair === 'XAUUSD') atrValid = currentAtr >= 1.5;
  else if (pair === 'XAGUSD') atrValid = currentAtr >= 0.08;
  else if (isCrypto) {
      const percentageAtr = (currentAtr / current5M.close) * 100;
      atrValid = percentageAtr >= 0.35;
  }
  else if (isVolatileForex) atrValid = (currentAtr / pipsMultiplier) >= 4;
  else atrValid = (currentAtr / pipsMultiplier) >= 2;

  if (!atrValid && !hardReject) {
      hardReject = 'REJECT_ATR_LOW';
  } else if (atrValid && !hardReject) {
      confidence += 3;
      cb.atr = 3;
      reason.push('+3 ATR Valid');
  }

  let pullbackValid = false;
  let pullbackExtreme = current5M.close;

  if (!hardReject) {
      if (bias === 'BUY') {
          confidence += 3; cb.trend = 3; reason.push('+3 4H Trend Bullish');
          
          if (current5M.close > currentEma) {
             confidence += 2; cb.ema = 2; reason.push('+2 EMA Alignment');
          } else {
             hardReject = 'REJECT_COUNTER_TREND';
          }

          pullbackExtreme = current5M.low;
          for (let i = lastIdx; i >= Math.max(0, lastIdx - 10); i--) {
             if (setup[i].low < pullbackExtreme) pullbackExtreme = setup[i].low;
             if (setup[i].low <= ema50[i]! * 1.0005 && setup[i].high >= ema50[i]! * 0.9995) {
                pullbackValid = true;
             }
          }
          if (pullbackValid) { confidence += 2; cb.pullback = 2; reason.push('+2 Clean Pullback'); }
          else { hardReject = 'REJECT_NO_PULLBACK'; }

          if (currentK > currentD && currentK <= 30) {
             confidence += 2; cb.stochastic = 2; reason.push('+2 Stochastic Confirm');
          } else {
             hardReject = 'REJECT_STOCHASTIC';
          }

          const body = Math.abs(current5M.close - current5M.open);
          const isGreen = current5M.close > current5M.open;
          const closeTop20 = current5M.close >= current5M.high - (currentCandleRange * 0.35);
          if (body >= 0.6 * currentCandleRange && closeTop20 && isGreen) {
             confidence += 2; cb.momentum = 2; reason.push('+2 Momentum Candle');
          } else {
             hardReject = 'REJECT_MOMENTUM';
          }

          if (['XAUUSD', 'XAGUSD'].includes(pair)) {
             if (current5M.close > currentVwap) {
                confidence += 2; cb.vwap = 2; reason.push('+2 VWAP Valid');
             } else {
                hardReject = 'REJECT_VWAP';
             }
          }

          if (current5M.close > prev5M.high) {
             confidence += 1; cb.structure = 1; reason.push('+1 Prev High Broken');
          }

      } else if (bias === 'SELL') {
          confidence += 3; cb.trend = 3; reason.push('+3 4H Trend Bearish');
          
          if (current5M.close < currentEma) {
             confidence += 2; cb.ema = 2; reason.push('+2 EMA Alignment');
          } else {
             hardReject = 'REJECT_COUNTER_TREND';
          }

          pullbackExtreme = current5M.high;
          for (let i = lastIdx; i >= Math.max(0, lastIdx - 10); i--) {
             if (setup[i].high > pullbackExtreme) pullbackExtreme = setup[i].high;
             if (setup[i].high >= ema50[i]! * 0.9995 && setup[i].low <= ema50[i]! * 1.0005) {
                pullbackValid = true;
             }
          }
          if (pullbackValid) { confidence += 2; cb.pullback = 2; reason.push('+2 Clean Pullback'); }
          else { hardReject = 'REJECT_NO_PULLBACK'; }

          if (currentK < currentD && currentK >= 70) {
             confidence += 2; cb.stochastic = 2; reason.push('+2 Stochastic Confirm');
          } else {
             hardReject = 'REJECT_STOCHASTIC';
          }

          const body = Math.abs(current5M.close - current5M.open);
          const isRed = current5M.close < current5M.open;
          const closeBottom20 = current5M.close <= current5M.low + (currentCandleRange * 0.35);
          if (body >= 0.6 * currentCandleRange && closeBottom20 && isRed) {
             confidence += 2; cb.momentum = 2; reason.push('+2 Momentum Candle');
          } else {
             hardReject = 'REJECT_MOMENTUM';
          }

          if (['XAUUSD', 'XAGUSD'].includes(pair)) {
             if (current5M.close < currentVwap) {
                confidence += 2; cb.vwap = 2; reason.push('+2 VWAP Valid');
             } else {
                hardReject = 'REJECT_VWAP';
             }
          }

          if (current5M.close < prev5M.low) {
             confidence += 1; cb.structure = 1; reason.push('+1 Prev Low Broken');
          }
      }
  }

  cb.final = confidence;

  const entryPrice = current5M.close;
  
  // WIDER, ATR-BASED SL: 1.5x ATR instead of fixed pips
  const slDistance = currentAtr * 1.5;
  let slPrice = entryPrice;
  
  if (direction === 'LONG') {
      slPrice = entryPrice - slDistance;
  } else {
      slPrice = entryPrice + slDistance;
  }

  const rawRiskPips = slDistance / pipsMultiplier;
  if (!hardReject && rawRiskPips > 60) {
      hardReject = 'REJECT_STOP_DISTANCE';
  }

  const riskValue = Math.abs(entryPrice - slPrice);
  const tp1 = direction === 'LONG' ? entryPrice + (riskValue * 1.0) : entryPrice - (riskValue * 1.0);
  const tp2 = direction === 'LONG' ? entryPrice + (riskValue * 2.0) : entryPrice - (riskValue * 2.0);
  const tp3 = direction === 'LONG' ? entryPrice + (riskValue * 3.0) : entryPrice - (riskValue * 3.0);

  let tier: Signal['tier'] = 'Reject';
  if (confidence >= 85) tier = 'Strong';
  else if (confidence >= 75) tier = 'Good';
  else if (confidence >= 65) tier = 'Valid';

  if (!hardReject && confidence < 65) {
      hardReject = 'REJECT_LOW_CONFIDENCE';
      tier = 'Reject';
  }

  if (hardReject) {
      if (hardReject === 'REJECT_SPIKE') rejectionStats.SPIKE++;
      else if (hardReject === 'REJECT_ATR_LOW') rejectionStats.ATR_LOW++;
      else if (hardReject === 'REJECT_EMA_FLAT') rejectionStats.EMA_FLAT++;
      else if (hardReject === 'REJECT_COUNTER_TREND') rejectionStats.COUNTER_TREND++;
      else if (hardReject === 'REJECT_NO_PULLBACK') rejectionStats.NO_PULLBACK++;
      else if (hardReject === 'REJECT_STOCHASTIC') rejectionStats.STOCHASTIC++;
      else if (hardReject === 'REJECT_MOMENTUM') rejectionStats.MOMENTUM++;
      else if (hardReject === 'REJECT_VWAP') rejectionStats.VWAP++;
      else if (hardReject === 'REJECT_STOP_DISTANCE') rejectionStats.STOP_DISTANCE++;
      else if (hardReject === 'REJECT_LOW_CONFIDENCE') rejectionStats.LOW_CONFIDENCE++;

      const entry_bucket = Math.round(entryPrice * 1000).toString();
      const rawHashStr = `${pair}_${direction}_${regime}_5M_${entry_bucket}`;
      const hashHex = crypto.createHash('sha256').update(rawHashStr).digest('hex');
      const deterministicId = `${hashHex.slice(0,8)}-${hashHex.slice(8,12)}-4${hashHex.slice(13,16)}-a${hashHex.slice(17,20)}-${hashHex.slice(20,32)}`;

      return { signal: {
        id: deterministicId,
        pair,
        direction,
        bias: direction === 'LONG' ? 'BULLISH' : 'BEARISH',
        score: confidence / 10,
        tier: 'Reject',
        aiConfidence: confidence,
        aiReason: hardReject,
        entry: entryPrice,
        sl: parseFloat(slPrice.toFixed(5)),
        tp1: parseFloat(tp1.toFixed(5)),
        tp2: parseFloat(tp2.toFixed(5)),
        tp3: parseFloat(tp3.toFixed(5)),
        timestamp: new Date().toISOString(),
        status: 'REJECTED',
        is_active: false,
        result: 'LOSS',
        diagnostics: {
          raw_4h: { open: last4H.open, close: last4H.close, start_time: last4H.timestamp },
          raw_5m_bos: { open: current5M.open, close: current5M.close, start_time: current5M.timestamp },
          pullbackHigh: pullbackExtreme,
          pullbackLow: pullbackExtreme,
          confidenceBreakdown: cb,
          regimeState: regime,
          pathTrace: `Input -> Regime(${regime}) -> Filter(REJECTED: ${hardReject}) -> Dedup(N/A) -> Active Check(N/A)`
        }
      }, scores, regime, regimeReason };
  }

  const entry_bucket = Math.round(entryPrice * 1000).toString();
  const rawHashStr = `${pair}_${direction}_${regime}_5M_${entry_bucket}`;
  const hashHex = crypto.createHash('sha256').update(rawHashStr).digest('hex');
  const deterministicId = `${hashHex.slice(0,8)}-${hashHex.slice(8,12)}-4${hashHex.slice(13,16)}-a${hashHex.slice(17,20)}-${hashHex.slice(20,32)}`;

  return { signal: {
    id: deterministicId,
    pair,
    direction,
    bias: direction === 'LONG' ? 'BULLISH' : 'BEARISH',
    score: confidence / 10,
    tier,
    aiConfidence: confidence,
    aiReason: reason.join('\n'),
    entry: entryPrice,
    sl: parseFloat(slPrice.toFixed(5)),
    tp1: parseFloat(tp1.toFixed(5)),
    tp2: parseFloat(tp2.toFixed(5)),
    tp3: parseFloat(tp3.toFixed(5)),
    timestamp: new Date().toISOString(),
    status: 'ACTIVE',
    is_active: true,
    result: 'OPEN',
    diagnostics: {
      raw_4h: { open: last4H.open, close: last4H.close, start_time: last4H.timestamp },
      raw_5m_bos: { open: current5M.open, close: current5M.close, start_time: current5M.timestamp },
      pullbackHigh: pullbackExtreme,
      pullbackLow: pullbackExtreme,
      confidenceBreakdown: cb,
      regimeState: regime,
      pathTrace: `Input -> Regime(${regime}) -> Filter(PASS) -> Signal(Gen) -> Score(${confidence}) -> Dedup -> Active Check -> Emit -> AI(Async)`
    }
  }, scores, regime, regimeReason };
}
