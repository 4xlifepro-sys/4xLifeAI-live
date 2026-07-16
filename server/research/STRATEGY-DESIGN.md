# 4xLifeAI Research Engine - Strategy Design Document

## Objective
Build a completely new forex signal engine from scratch. Do NOT modify or reuse logic from the production engine (`engine-mean-reversion.ts`). This is pure research.

## Design Philosophy
- Optimize for positive expectancy, stability, robustness, low drawdown, consistency
- Avoid overfitting to historical data
- Each strategy must be independently viable
- Walk-forward validation required before any production consideration

---

## Stage 1: Strategy Concepts

### Strategy 1: Trend Pullback (EMA Cascade)
**Core Idea:** Enter on pullbacks within established multi-timeframe trends

**Entry Rules:**
- H4: Price above EMA100 (bullish) or below EMA100 (bearish)
- H1: EMA20 > EMA50 > EMA100 (bullish cascade) or reverse (bearish)
- M15: Price pulls back to EMA20 or EMA50
- Entry trigger: Bullish/bearish engulfing or pin bar at the EMA
- RSI(14): 40-60 during pullback (not extreme)

**Exit Rules:**
- SL: Beyond recent swing low/high + 1.5x ATR buffer
- TP1: 1.5R (previous swing high/low)
- TP2: 2.5R
- TP3: 4R
- Trail: Move SL to breakeven after TP1 hit

**Confidence Factors:**
- +15: H4/H1 trend alignment
- +10: Clean pullback to EMA (not overshooting)
- +10: Strong reversal candle
- +5: RSI in healthy zone
- +5: ATR expanding
- Base: 55, Max: 100

**Filters:**
- Session: London/NY only (07:00-21:00 UTC)
- Min 30min between signals per pair
- Skip if major news within 1 hour (placeholder)

---

### Strategy 2: Trend Continuation (Breakout + Retest)
**Core Idea:** Trade the retest after a breakout, not the initial breakout

**Entry Rules:**
- Identify consolidation range (20-bar Donchian channel)
- Wait for breakout: close beyond range high/low with strong momentum
- Wait for retest: price returns to breakout level
- Entry: Rejection candle at the retest (pin bar, engulfing)
- Volume proxy: Breakout candle range > 1.5x 20-bar average

**Exit Rules:**
- SL: Beyond the consolidation range opposite side
- TP1: 1R (measured move = range height)
- TP2: 2R
- TP3: 3R
- No trail (fixed targets based on range projection)

**Confidence Factors:**
- +15: Clear consolidation before breakout
- +10: Strong breakout candle (large body, high range)
- +10: Clean retest (holds breakout level)
- +5: Volume expansion on breakout
- +5: RSI confirming momentum (55-70 long, 30-45 short)
- Base: 55, Max: 100

**Filters:**
- Session: London/NY only
- Min 45min between signals (breakouts need time to develop)
- Skip if ATR < 20-bar average (low volatility = fakeout risk)

---

### Strategy 3: Volatility Breakout (ATR Expansion)
**Core Idea:** Trade the first strong move after a low-volatility contraction

**Entry Rules:**
- ATR(14) < 0.7x ATR(50) for at least 10 bars (volatility contraction)
- Wait for expansion: ATR(14) > 1.3x ATR(50)
- Direction: First strong candle in expansion direction (close in top/bottom 25% of range)
- Entry: On close of expansion candle
- RSI: Not extreme (<75 long, >25 short)

**Exit Rules:**
- SL: Opposite side of contraction range (or 2x ATR, whichever is tighter)
- TP1: 1.5R
- TP2: 3R
- TP3: 5R
- Trail: After TP2, trail with 10-bar ATR

**Confidence Factors:**
- +15: Long contraction period (>15 bars)
- +10: Strong expansion candle (body > 70% of range)
- +10: ATR expansion > 1.5x average
- +5: RSI in momentum zone (50-70 long, 30-50 short)
- +5: Session overlap (London/NY)
- Base: 55, Max: 100

**Filters:**
- Session: Any (breakouts can happen anytime, but prefer London/NY)
- Min 60min between signals (volatility cycles take time)
- Skip if within 30min of previous signal on same pair

---

### Strategy 4: Mean Reversion (Bollinger Extreme + Divergence)
**Core Idea:** Fade extreme moves when momentum is diverging (different from production engine)

**Entry Rules:**
- Price closes beyond 2.5x Bollinger Band (more extreme than production's 2.0x)
- RSI divergence: Price makes new extreme but RSI does NOT (hidden divergence)
- Wait for reversal confirmation: candle closes back inside the band
- Entry: On close of confirmation candle
- Volume: Reversal candle range > 1.2x 20-bar average

**Exit Rules:**
- SL: Beyond the extreme wick + 1x ATR
- TP1: Middle band (20 SMA) - typically 0.5-0.8R
- TP2: Opposite band edge - typically 1.5-2R
- TP3: 2.5R (extended reversion)
- No trail (mean reversion targets are fixed)

**Confidence Factors:**
- +15: Clear RSI divergence (price extreme, RSI not)
- +10: Price > 2.5x band (very extreme)
- +10: Strong reversal candle (engulfing or pin bar)
- +5: Volume confirmation
- +5: RSI returning to neutral (40-60)
- Base: 55, Max: 100

**Filters:**
- Session: London/NY only
- Min 30min between signals
- Skip if trending market (ADX > 30 = trending, skip mean reversion)

---

### Strategy 5: Liquidity Sweep (False Breakout Reversal)
**Core Idea:** Trade the reversal after a false breakout that sweeps liquidity

**Entry Rules:**
- Identify key level: recent swing high/low, round number, or previous day high/low
- Wait for sweep: price breaks the level by 1-2x ATR then reverses
- Reversal confirmation: strong candle closing back beyond the level
- Entry: On close of reversal candle
- RSI: Extreme reading during sweep (>80 or <20)

**Exit Rules:**
- SL: Beyond the sweep extreme + 0.5x ATR
- TP1: Opposite side of the range (1-1.5R)
- TP2: 2.5R
- TP3: 4R
- Trail: After TP1, trail with 5-bar ATR

**Confidence Factors:**
- +15: Clear liquidity sweep (breaks level, reverses hard)
- +10: RSI extreme during sweep (>80/<20)
- +10: Strong reversal candle (engulfing)
- +5: Volume spike on reversal
- +5: Key level (round number or previous day high/low)
- Base: 55, Max: 100

**Filters:**
- Session: London/NY only (liquidity sweeps happen during active hours)
- Min 45min between signals
- Skip if ADX > 35 (strong trend = sweep might continue)

---

### Strategy 6: Support/Resistance Bounce (Key Level Reaction)
**Core Idea:** Trade bounces off clearly defined support/resistance levels

**Entry Rules:**
- Identify S/R level: at least 3 touches in past 50 bars, or major round number
- Wait for approach: price within 0.5x ATR of the level
- Entry trigger: Rejection candle at the level (pin bar, doji, small body)
- RSI: Not extreme (30-70 range, showing room to move)
- Volume: Rejection candle range > 1.3x 20-bar average

**Exit Rules:**
- SL: Beyond the S/R level + 1x ATR
- TP1: Next S/R level or 1.5R
- TP2: 2.5R
- TP3: 4R
- Trail: After TP1, move SL to breakeven

**Confidence Factors:**
- +15: Multiple touches (3+ times tested)
- +10: Clean rejection (long wick, small body)
- +10: Round number level (psychological significance)
- +5: RSI in healthy zone (40-60)
- +5: Volume confirmation
- Base: 55, Max: 100

**Filters:**
- Session: London/NY only
- Min 30min between signals
- Skip if price has already moved 2x ATR away from level (missed the bounce)

---

## Stage 2: Implementation Plan

Each strategy will be implemented as:
- `server/research/engine-{strategy-name}.ts` - Isolated engine file
- `server/research/backtest-{strategy-name}.ts` - Isolated backtest runner
- No imports from production engines
- No modifications to scanner.ts or any live file

## Stage 3: Backtest Metrics

For each strategy, measure:
- Total trades, Win rate, Profit Factor
- Expectancy (R per trade)
- Average winner, Average loser
- Maximum drawdown (R and %)
- Recovery factor (Net profit / Max DD)
- Sharpe ratio (if feasible)
- Monthly returns (consistency)
- Trades per pair (distribution)
- Trades by session (London vs NY vs overlap)
- Trades by weekday (Mon-Fri distribution)

## Stage 4: Walk-Forward Validation

- Split 6-month data: months 1-4 (in-sample), months 5-6 (out-of-sample)
- Report both periods separately
- Pass criteria: avgR out-of-sample > 0 AND > 30% of in-sample avgR
- Flag any strategy that collapses out-of-sample

## Stage 5: Stress Testing

Test each strategy across:
- Trending markets (ADX > 25)
- Ranging markets (ADX < 20)
- High volatility (ATR > 1.5x average)
- Low volatility (ATR < 0.7x average)
- Different sessions (London, NY, Asian)
- Different weekdays

## Stage 6: Ranking & Report

Rank strategies by:
1. Out-of-sample avgR (primary)
2. Profit Factor
3. Max drawdown
4. Consistency (monthly win rate)
5. Trade frequency (enough sample size)

Produce comparison table with recommendation.

---

## Rules

- Do NOT modify `engine-mean-reversion.ts` or any production file
- All research files go in `server/research/` subdirectory
- No deployment until walk-forward validation passes
- No cherry-picking: report all results, including failures
- Quantitative evidence only, no opinions
