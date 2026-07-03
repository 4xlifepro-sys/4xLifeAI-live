import { fetchCandles } from './server/twelvedata-scanner.js';
import { getPipMultiplier } from './server/engine.js';

function getEma(candles: any[], period: number) {
    const k = 2 / (period + 1);
    let ema = candles[0].close;
    for (let i = 1; i < candles.length; i++) {
        ema = (candles[i].close * k) + (ema * (1 - k));
    }
    return ema;
}

const reqPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY', 'EURAUD', 'EURNZD', 'GBPAUD', 'XAUUSD', 'XAGUSD', 'BTCUSD'];

async function run() {
    let momentumRejects = [];
    let stats = {
        bodyFailureOnly: 0,
        closeFailureOnly: 0,
        bodyAndCloseFailure: 0,
        bodies: [] as number[],
        closes: [] as number[],
    };

    let pairResults = [];

    const calculateATR = (candles: any[], period: number) => {
        const atr = [];
        let sumTr = 0;
        for (let i = 0; i < candles.length; i++) {
          if (i === 0) { atr.push(null); continue; }
          const high = candles[i].high, low = candles[i].low, prevClose = candles[i - 1].close;
          const trueRange = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
          if (i < period) {
            sumTr += trueRange;
            atr.push(null);
            if (i === period - 1) atr[i] = sumTr / period;
          } else {
            atr.push((atr[i - 1]! * (period - 1) + trueRange) / period);
          }
        }
        return atr;
    };

    for (const pair of reqPairs) {
        try {
            const candles5m = await fetchCandles(pair, '5min');
            if (!candles5m || candles5m.length < 50) {
                 continue;
            }

            // Engine Logic: Check direction from 15m and 50EMA
            const candles15m = await fetchCandles(pair, '15min');
            if(!candles15m || candles15m.length < 50) continue;
            
            const ema50_15m = getEma(candles15m, 50);
            const current15M = candles15m[candles15m.length - 1];
            let direction = 'NONE';
            if (current15M.close > ema50_15m) direction = 'LONG';
            else if (current15M.close < ema50_15m) direction = 'SHORT';

            const atrVals = calculateATR(candles5m, 14);
            const currentAtr = atrVals[atrVals.length - 1];
            let requiredAtr = 2;
            let valAtr = 0;
            
            const pipsMultiplier = getPipMultiplier(pair);
            const isVolatileForex = pair.includes('GBP') || pair.includes('JPY') || pair.includes('NZD') || pair.includes('CAD');
            
            if (pair === 'XAUUSD') { requiredAtr = 1.5; valAtr = currentAtr; }
            else if (pair === 'XAGUSD') { requiredAtr = 0.08; valAtr = currentAtr; }
            else if (pair === 'BTCUSD') { requiredAtr = 0.35; valAtr = (currentAtr / candles5m[candles5m.length - 1].close) * 100; }
            else if (isVolatileForex) { requiredAtr = 4; valAtr = currentAtr / pipsMultiplier; }
            else { requiredAtr = 2; valAtr = currentAtr / pipsMultiplier; }
            
            const atrPass = valAtr >= requiredAtr;

            const current5M = candles5m[candles5m.length - 1];
            const currentCandleRange = current5M.high - current5M.low;
            const body = Math.abs(current5M.close - current5M.open);
            
            const bodyPercent = currentCandleRange === 0 ? 0 : (body / currentCandleRange);
            
            let closePositionPercent = 0;
            let isTrendColor = false;
            if (direction === 'LONG') {
                closePositionPercent = currentCandleRange === 0 ? 0 : ((current5M.high - current5M.close) / currentCandleRange);
                isTrendColor = current5M.close > current5M.open;
            } else if (direction === 'SHORT') {
                closePositionPercent = currentCandleRange === 0 ? 0 : ((current5M.close - current5M.low) / currentCandleRange);
                isTrendColor = current5M.close < current5M.open;
            }

            const bodyPass = bodyPercent >= 0.6;
            const closePass = closePositionPercent <= 0.2;
            
            // Record stats
            if (direction !== 'NONE') {
                stats.bodies.push(bodyPercent);
                stats.closes.push(closePositionPercent);
            }

            const momentumPass = bodyPass && closePass && isTrendColor;
            
            if (direction !== 'NONE' && (!momentumPass || !isTrendColor)) { // This counts as momentum rejection
                let reason = 'Momentum';
                let failType = '';
                if (!bodyPass && closePass && isTrendColor) { stats.bodyFailureOnly++; failType = 'BODY_FAILURE_ONLY'; }
                else if (bodyPass && !closePass && isTrendColor) { stats.closeFailureOnly++; failType = 'CLOSE_FAILURE_ONLY'; }
                else { stats.bodyAndCloseFailure++; failType = 'BODY_AND_CLOSE_FAILURE'; }

                momentumRejects.push({
                    pair,
                    direction,
                    bodyPercent: (bodyPercent * 100).toFixed(1),
                    closePositionPercent: (closePositionPercent * 100).toFixed(1),
                    failType,
                    rawColorFail: !isTrendColor
                });
            }

            let finalResult = 'ACCEPT';
            if (!atrPass) finalResult = 'REJECT (ATR)';
            else if (!momentumPass || !isTrendColor) finalResult = 'REJECT (MOMENTUM)';
            // We ignore other rules for this simplified trace

            pairResults.push({
                pair,
                atrPass: atrPass ? 'PASS' : 'FAIL',
                momentumPass: (momentumPass && isTrendColor && direction !== 'NONE') ? 'PASS' : 'FAIL',
                finalResult: direction === 'NONE' ? 'NONE' : finalResult
            });

            await new Promise(r => setTimeout(r, 800));
        } catch (e) {
            console.error(e);
        }
    }

    console.log('════════════════════════════════════');
    console.log('SECTION 1 — MOMENTUM REJECTION INVENTORY');
    console.log('════════════════════════════════════');
    for (const r of momentumRejects) {
        console.log(r.pair);
        console.log(r.direction);
        console.log(`Body: ${r.bodyPercent}%`);
        console.log(`Required: 60.0%`);
        console.log(`Close Position: ${r.closePositionPercent}%`);
        console.log(`Required: 20.0%`);
        console.log('---');
    }

    console.log('\\n════════════════════════════════════');
    console.log('SECTION 2 — FAILURE CLASSIFICATION');
    console.log('════════════════════════════════════');
    console.log(`BODY_FAILURE_ONLY: ${stats.bodyFailureOnly}`);
    console.log(`CLOSE_FAILURE_ONLY: ${stats.closeFailureOnly}`);
    console.log(`BODY_AND_CLOSE_FAILURE: ${stats.bodyAndCloseFailure}`); // includes color failures

    console.log('\\n════════════════════════════════════');
    console.log('SECTION 3 — BODY STATISTICS');
    console.log('════════════════════════════════════');
    stats.bodies.sort((a,b)=>a-b);
    const avgBody = stats.bodies.reduce((a,b)=>a+b,0) / (stats.bodies.length || 1);
    const medBody = stats.bodies.length > 0 ? stats.bodies[Math.floor(stats.bodies.length/2)] : 0;
    const minBody = stats.bodies[0] || 0;
    const maxBody = stats.bodies[stats.bodies.length-1] || 0;

    console.log(`Average Body %: ${(avgBody*100).toFixed(1)}%`);
    console.log(`Median Body %: ${(medBody*100).toFixed(1)}%`);
    console.log(`Lowest Body %: ${(minBody*100).toFixed(1)}%`);
    console.log(`Highest Body %: ${(maxBody*100).toFixed(1)}%`);

    console.log('\\n════════════════════════════════════');
    console.log('SECTION 4 — CLOSE POSITION STATISTICS');
    console.log('════════════════════════════════════');
    stats.closes.sort((a,b)=>a-b);
    const avgClose = stats.closes.reduce((a,b)=>a+b,0) / (stats.closes.length || 1);
    const medClose = stats.closes.length > 0 ? stats.closes[Math.floor(stats.closes.length/2)] : 0;
    const minClose = stats.closes[0] || 0;
    const maxClose = stats.closes[stats.closes.length-1] || 0;

    console.log(`Average Close Position %: ${(avgClose*100).toFixed(1)}%`);
    console.log(`Median Close Position %: ${(medClose*100).toFixed(1)}%`);
    console.log(`Lowest Close Position %: ${(minClose*100).toFixed(1)}%`);
    console.log(`Highest Close Position %: ${(maxClose*100).toFixed(1)}%`);

    console.log('\\n════════════════════════════════════');
    console.log('SECTION 5 — PAIR BREAKDOWN');
    console.log('════════════════════════════════════');
    for (const pr of pairResults) {
        console.log(pr.pair);
        console.log(`ATR: ${pr.atrPass}`);
        console.log(`MOMENTUM: ${pr.momentumPass}`);
        console.log(`FINAL: ${pr.finalResult}`);
        console.log('---');
    }

    console.log('\\n════════════════════════════════════');
    console.log('SECTION 6 — ACCEPTANCE SIMULATION');
    console.log('════════════════════════════════════');
    
    const simulate = (bodyReq: number, closeReq: number) => {
        let acc = 0, rej = 0;
        for (const pr of momentumRejects) {
            if (pr.rawColorFail) { rej++; continue; }
            if (parseFloat(pr.bodyPercent) >= bodyReq*100 && parseFloat(pr.closePositionPercent) <= closeReq*100) {
                acc++;
            } else {
                rej++;
            }
        }
        // what about ones that already passed?
        const alreadyPassed = pairResults.filter(p => p.momentumPass === 'PASS').length;
        acc += alreadyPassed;
        
        const totalDirs = stats.bodies.length; // number of directed pairs
        // NOTE: Actually just for the ones we evaluated.
        const total = momentumRejects.length + alreadyPassed;
        const rate = total > 0 ? (acc/total)*100 : 0;
        console.log(`Accepted Signals: ${acc}`);
        console.log(`Rejected Signals: ${rej}`);
        console.log(`Acceptance Rate %: ${rate.toFixed(1)}%`);
    }

    console.log('Scenario A (Body >= 60%, Close <= 20%)');
    simulate(0.60, 0.20);
    console.log('\\nScenario B (Body >= 55%, Close <= 25%)');
    simulate(0.55, 0.25);
    console.log('\\nScenario C (Body >= 50%, Close <= 30%)');
    simulate(0.50, 0.30);

    console.log('\\n════════════════════════════════════');
    console.log('SECTION 7 — PRIMARY BOTTLENECK');
    console.log('════════════════════════════════════');
    let maxReason = 'C) Both Equally / Color Mismatch';
    if (stats.bodyFailureOnly > stats.closeFailureOnly && stats.bodyFailureOnly > stats.bodyAndCloseFailure) {
        maxReason = 'A) Candle Body Threshold';
    } else if (stats.closeFailureOnly > stats.bodyFailureOnly && stats.closeFailureOnly > stats.bodyAndCloseFailure) {
        maxReason = 'B) Close Position Threshold';
    }
    console.log(maxReason);

    console.log('\\n════════════════════════════════════');
    console.log('SECTION 8 — FINAL VERDICT');
    console.log('════════════════════════════════════');
    // Simplified logic for verdict
    if (avgBody < 0.6 && avgClose > 0.2) {
       console.log('D) Both thresholds excessively strict');
    } else if (avgBody < 0.6) {
       console.log('B) Body threshold excessively strict');
    } else if (avgClose > 0.2) {
       console.log('C) Close-position threshold excessively strict');
    } else {
       console.log('A) Momentum filter operating correctly');
    }
}
run();
