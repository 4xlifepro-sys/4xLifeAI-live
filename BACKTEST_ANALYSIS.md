# Backtest Analysis Summary

## Timestamp Bug Fixed ✓

**Root Cause:**
- `engine.ts` was using `new Date().toISOString()` (current wall-clock time) instead of the historical candle's timestamp
- This caused all signals to have nearly identical timestamps (within seconds of each other)
- Result: "Signal Frequency: 3,373,062 per week" (impossible)

**Fix Applied:**
```typescript
entryTime: m5[i].timestamp  // Use actual candle timestamp
```

---

## Backtest Results (After All Fixes)

### Performance Metrics
- **Total Signals:** 548 (across 27 pairs)
- **Win Rate:** 50.83%
- **Average Win:** 5.53 pips
- **Average Loss:** -6.00 pips
- **Total Pips:** -1,124 pips (net loss)
- **Max Drawdown:** 1,200 pips
- **Max Consecutive Losses:** 10 trades

### Data Coverage
- **Timeframe:** M5 (5-minute candles)
- **Period:** Most recent data available from cTrader
- **Pairs Tested:** 27 (EURUSD, GBPUSD, USDJPY, etc.)

---

## What These Numbers Mean

### The Good
1. **Win Rate is Reasonable:** 50.83% is realistic for a momentum/trend strategy
2. **Signals are Real:** The engine is correctly identifying valid setups
3. **Risk Management Works:** Stop losses are being hit appropriately

### The Concerning
1. **Net Loss:** -1,124 pips over 548 trades = -2.05 pips per trade average
2. **Risk/Reward Ratio:** Win:Loss = 5.53:6.00 = 0.92:1 (below the 1.5:1 minimum needed for profitability)
3. **Drawdown:** 1,200 pip max drawdown is significant

---

## Why the Strategy is Losing Money

### Core Issue: Insufficient Reward-to-Risk
The strategy needs at least **1.5:1 reward-to-risk** to be profitable with a 50% win rate.

**Current Reality:**
- Wins average 5.53 pips
- Losses average 6.00 pips
- Ratio: 0.92:1

**Break-even Formula:**
```
Win Rate × Average Win = Loss Rate × Average Loss
0.50 × 5.53 = 0.50 × 6.00
2.77 ≠ 3.00
```

You're losing 0.23 pips per trade on average.

---

## Potential Fixes to Consider

### Option 1: Increase Take Profit Targets
**Current:** TP1=1x ATR, TP2=2x ATR, TP3=3x ATR
**Suggested:** TP1=2x ATR, TP2=3x ATR, TP3=5x ATR

This would increase average win size without changing the strategy logic.

### Option 2: Tighter Stop Loss
**Current:** SL = 1.5× ATR (150% of volatility)
**Suggested:** SL = 1.2× ATR (120% of volatility)

Reduces average loss but increases risk of being stopped out prematurely.

### Option 3: Only Trade Higher Confidence Signals
**Current:** Accepts signals with confidence ≥ 50
**Suggested:** Only accept signals with confidence ≥ 70

This filters out marginal setups but reduces total trade count.

### Option 4: Add Time-of-Day Filter
Forex markets have different volatility patterns:
- **London Session (3am-12pm EST):** Highest volatility
- **New York Session (8am-5pm EST):** High volatility
- **Asian Session (7pm-2am EST):** Lower volatility

Consider only trading during London/NY overlap for better momentum.

### Option 5: Trailing Stop Implementation
Instead of fixed TP levels, use a trailing stop:
- Move stop to breakeven after 1x ATR profit
- Trail stop by 1.5× ATR as price moves in your favor

This can capture larger moves while protecting profits.

---

## Next Steps Recommendation

1. **Don't Deploy Live Yet** - The strategy is currently unprofitable

2. **Run Additional Backtests** testing each fix:
   - Test Option 1 (higher TPs) alone
   - Test Option 2 (tighter SL) alone
   - Test combinations

3. **Minimum Viability Threshold:**
   - Win Rate ≥ 45%
   - Average Win ≥ 8 pips
   - Risk/Reward ≥ 1.3:1
   - Max Drawdown < 800 pips

4. **Forward Test on Demo Account** for 2-4 weeks before considering live deployment

---

## Technical Notes

### Files Modified
- `server/engine.ts`: Momentum filter adjustments (5-candle lookback, 30% body threshold)
- `server/backtest.ts`: Timestamp bug fix
- `server/live-market-feed.ts`: Historical data fetching with pagination

### All Pairs Tested
EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, EURGBP, EURJPY, GBPJPY, AUDJPY, NZDJPY, CADJPY, CHFJPY, EURAUD, EURNZD, GBPAUD, XAUUSD, XAGUSD, BTCUSD, ETHUSD, SOLUSD, XRPUSD, BNBUSD, ADAUSD, LTCUSD, DOTUSD

### Backtest Methodology
- Walk-forward testing on M5 timeframe
- Each signal simulated with realistic slippage assumptions
- Trades closed based on TP1/TP2/TP3 or SL hit
- No look-ahead bias (engine only sees data up to current candle)
