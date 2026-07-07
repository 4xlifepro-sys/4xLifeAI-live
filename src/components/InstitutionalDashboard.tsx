import React, { useMemo, useState } from "react";

/**
 * ============================================================================
 * 4xFiveAI — Professional Trading Terminal Dashboard
 * ============================================================================
 *
 * DESIGN DIRECTION: Institutional trading terminal (Bloomberg/Reuters-inspired),
 * not a generic SaaS dashboard. Dense, monospaced, amber/cyan accent system on
 * a near-black terminal background.
 *
 * HOW TO WIRE THIS UP (for the coding agent):
 * - Replace the `sampleData` object below with real data from your API.
 * - The component accepts a `data` prop matching the `DashboardData` shape.
 * - If no `data` prop is passed, it falls back to `sampleData` for preview.
 * - All colors/fonts are defined once in the <style> block — change tokens
 *   at the top of the CSS to re-theme everything at once.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Types — match these to your real API response shape
// ---------------------------------------------------------------------------

type Trend = "BULL" | "BEAR" | "NEUTRAL";

interface WatchlistItem {
  pair: string;
  price: number;
  trend: Trend;
  changePct?: number; // 24h % change, optional
}

interface WatchlistGroup {
  label: string; // "FOREX" | "METALS" | "CRYPTO"
  code: string; // "FX" | "MT" | "CR" — short badge shown next to label
  items: WatchlistItem[];
}

interface ActiveSignal {
  pair: string;
  direction: "LONG" | "SHORT";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3?: number;
  status: "profit" | "loss" | "pending";
  tradeStatus?: string;
  statusPips?: number;
  tier?: "Strong" | "Good" | "Valid";
  openedAgo: string; // e.g. "12m ago"
}

interface ClosedSignal {
  pair: string;
  direction: "LONG" | "SHORT";
  entry: number;
  exit: number;
  result: "win" | "loss" | "breakeven";
  pips: number;
  closedAt: string; // e.g. "Jul 4, 14:20"
}

interface DashboardData {
  brand: string;
  tagline: string;
  session: string; // "LONDON SESSION"
  pairCount: number;
  weekendMode?: string; // e.g. "Crypto & Metals only" — omit if not weekend
  clockUtc: string;
  stats: {
    winRate30d: number; // 0-100
    winRateTrend?: "up" | "down" | "flat";
    signalsThisMonth: number;
    signalsSince: string; // "Since Jul 1"
    wins: number;
    losses: number;
    activeCount: number;
    bullishCount: number;
    bearishCount: number;
    avgRR: number | null; // null renders as "1:--"
    totalPipsClosed: number;
  };
  activeSignals: ActiveSignal[];
  watchlist: WatchlistGroup[];
  history: ClosedSignal[];
}

// ---------------------------------------------------------------------------
// Sample data — used only when no `data` prop is supplied (preview mode)
// ---------------------------------------------------------------------------

const sampleData: DashboardData = {
  brand: "4xFiveAI",
  tagline: "Premium Signal Intelligence",
  session: "LONDON SESSION",
  pairCount: 10,
  weekendMode: "Crypto & Metals only",
  clockUtc: "07:41:02 UTC",
  stats: {
    winRate30d: 47.3,
    winRateTrend: "up",
    signalsThisMonth: 62,
    signalsSince: "Since Jul 1",
    wins: 29,
    losses: 33,
    activeCount: 2,
    bullishCount: 4,
    bearishCount: 0,
    avgRR: 2.4,
    totalPipsClosed: 624,
  },
  activeSignals: [
    {
      pair: "XAUUSD",
      direction: "LONG",
      entry: 4175.07,
      sl: 4162.4,
      tp1: 4198.5,
      tp2: 4212.1,
      tp3: 4229.8,
      status: "profit",
      statusPips: 14,
      tier: "Strong",
      openedAgo: "18m ago",
    },
    {
      pair: "BTCUSD",
      direction: "LONG",
      entry: 62680.0,
      sl: 62210.0,
      tp1: 63400.0,
      tp2: 63920.0,
      status: "pending",
      tier: "Good",
      openedAgo: "4m ago",
    },
  ],
  watchlist: [
    {
      label: "FOREX",
      code: "FX",
      items: [
        { pair: "EURUSD", price: 1.1436, trend: "NEUTRAL", changePct: 0.02 },
        { pair: "USDJPY", price: 161.368, trend: "NEUTRAL", changePct: -0.11 },
        { pair: "USDCAD", price: 1.4203, trend: "NEUTRAL", changePct: 0.04 },
        { pair: "NZDUSD", price: 0.57072, trend: "NEUTRAL", changePct: -0.03 },
        { pair: "EURJPY", price: 184.576, trend: "NEUTRAL", changePct: 0.07 },
        { pair: "GBPJPY", price: 215.466, trend: "NEUTRAL", changePct: 0.01 },
      ],
    },
    {
      label: "METALS",
      code: "MT",
      items: [
        { pair: "XAUUSD", price: 4175.07, trend: "BULL", changePct: 0.68 },
        { pair: "XAGUSD", price: 62.369, trend: "BULL", changePct: 0.41 },
      ],
    },
    {
      label: "CRYPTO",
      code: "CR",
      items: [
        { pair: "BTCUSD", price: 62849.55, trend: "BULL", changePct: 1.12 },
        { pair: "ETHUSD", price: 1763.49, trend: "BULL", changePct: 0.87 },
      ],
    },
  ],
  history: [
    { pair: "EURUSD", direction: "LONG", entry: 1.1402, exit: 1.1421, result: "win", pips: 19, closedAt: "Jul 4, 19:05" },
    { pair: "USDJPY", direction: "SHORT", entry: 161.88, exit: 161.62, result: "win", pips: 26, closedAt: "Jul 4, 16:40" },
    { pair: "GBPJPY", direction: "LONG", entry: 214.90, exit: 214.55, result: "loss", pips: -35, closedAt: "Jul 4, 12:15" },
    { pair: "XAUUSD", direction: "LONG", entry: 4148.20, exit: 4171.60, result: "win", pips: 234, closedAt: "Jul 4, 09:50" },
    { pair: "AUDNZD", direction: "SHORT", entry: 1.0821, exit: 1.0819, result: "breakeven", pips: 2, closedAt: "Jul 3, 22:30" },
    { pair: "USDCAD", direction: "LONG", entry: 1.4180, exit: 1.4152, result: "loss", pips: -28, closedAt: "Jul 3, 18:05" },
    { pair: "ETHUSD", direction: "LONG", entry: 1732.10, exit: 1758.40, result: "win", pips: 263, closedAt: "Jul 3, 14:22" },
  ],
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 100) return n.toFixed(3);
  return n.toFixed(n < 10 ? 5 : 4);
}

function trendClass(t: Trend): string {
  return t === "BULL" ? "x4-pill--bull" : t === "BEAR" ? "x4-pill--bear" : "x4-pill--neutral";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Dashboard({ data }: { data?: DashboardData }) {
  const d = data ?? sampleData;

  const totalWatchlist = useMemo(
    () => d.watchlist.reduce((sum, g) => sum + g.items.length, 0),
    [d.watchlist]
  );

  return (
    <div className="x4-root">
      <style>{CSS}</style>

      {/* ---------------- Ticker strip (signature element) ---------------- */}
      <div className="x4-ticker" aria-hidden="true">
        <div className="x4-ticker__track">
          {[...d.watchlist.flatMap((g) => g.items), ...d.watchlist.flatMap((g) => g.items)].map(
            (item, i) => (
              <span className="x4-ticker__item" key={i}>
                <span className="x4-ticker__pair">{item.pair}</span>
                <span className={`x4-ticker__price x4-ticker__price--${item.trend.toLowerCase()}`}>{fmtPrice(item.price)}</span>
                <span className={`x4-ticker__chg ${item.changePct != null && item.changePct >= 0 ? "up" : "down"}`}>
                  {item.changePct != null ? `${item.changePct >= 0 ? "▲" : "▼"} ${Math.abs(item.changePct).toFixed(2)}%` : ""}
                </span>
              </span>
            )
          )}
        </div>
      </div>

      {/* ---------------- Header ---------------- */}
      <header className="x4-header">
        <div className="x4-header__left">
          <span className="x4-live-dot" />
          <span className="x4-brand">{d.brand}</span>
          <span className="x4-badge x4-badge--live">LIVE</span>
          <span className="x4-divider" />
          <span className="x4-session">{d.session}</span>
          <span className="x4-muted">{d.pairCount} PAIRS</span>
        </div>
        <div className="x4-header__right">
          <span className="x4-tradelog">TRADE LOG</span>
          <span className="x4-clock">{d.clockUtc}</span>
        </div>
      </header>

      {d.weekendMode && (
        <div className="x4-banner">
          <span className="x4-banner__tag">WEEKEND MODE</span>
          <span>{d.weekendMode}</span>
        </div>
      )}

      <main className="x4-main">
        {/* ---------------- Stat cards ---------------- */}
        <section className="x4-stats" aria-label="Performance summary">
          <StatCard
            label="WIN RATE"
            value={`${d.stats.winRate30d.toFixed(1)}%`}
            sub="Last 30 days"
            foot={`${d.stats.wins}W ${d.stats.losses}L`}
            trend={d.stats.winRateTrend}
          />
          <StatCard
            label="SIGNALS THIS MONTH"
            value={String(d.stats.signalsThisMonth)}
            sub={d.stats.signalsSince}
            foot={`${d.stats.wins} wins, ${d.stats.losses} losses`}
          />
          <StatCard
            label="ACTIVE NOW"
            value={String(d.stats.activeCount)}
            sub="Scanning markets"
            foot={`${d.stats.bullishCount} bullish, ${d.stats.bearishCount} bearish`}
            pulse={d.stats.activeCount > 0}
          />
          <StatCard
            label="AVG RISK:REWARD"
            value={d.stats.avgRR != null ? `1:${d.stats.avgRR.toFixed(1)}` : "1:--"}
            sub="From closed trades"
            foot={`Total: ${d.stats.totalPipsClosed >= 0 ? "+" : ""}${d.stats.totalPipsClosed} pips`}
          />
        </section>

        {/* ---------------- Active signals ---------------- */}
        <section className="x4-section">
          <div className="x4-section__head">
            <h2>Active Signals</h2>
            <span className="x4-count">{d.activeSignals.length}</span>
          </div>

          {d.activeSignals.length === 0 ? (
            <div className="x4-empty">
              <div className="x4-empty__spinner" />
              <div className="x4-empty__title">No active signals</div>
              <div className="x4-empty__sub">Scanning {totalWatchlist} pairs in real-time</div>
            </div>
          ) : (
            <div className="x4-signals">
              {d.activeSignals.map((s, i) => (
                <ActiveSignalCard key={i} s={s} />
              ))}
            </div>
          )}
        </section>

        {/* ---------------- Watchlist ---------------- */}
        <section className="x4-section">
          <div className="x4-section__head">
            <h2>Market Watchlist</h2>
          </div>

          {d.watchlist.map((group) => (
            <div className="x4-group" key={group.label}>
              <div className="x4-group__label">
                <span className="x4-group__code">{group.code}</span>
                {group.label} <span className="x4-muted">({group.items.length})</span>
              </div>
              <div className="x4-rows">
                {group.items.map((item) => (
                  <div className="x4-row" key={item.pair}>
                    <span className="x4-row__pair">{item.pair}</span>
                    <span className={`x4-row__price x4-row__price--${item.trend.toLowerCase()}`}>{fmtPrice(item.price)}</span>
                    {item.changePct != null && (
                      <span className={`x4-row__chg ${item.changePct >= 0 ? "up" : "down"}`}>
                        {item.changePct >= 0 ? "+" : ""}
                        {item.changePct.toFixed(2)}%
                      </span>
                    )}
                    <span className={`x4-pill ${trendClass(item.trend)}`}>{item.trend}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* ---------------- History ---------------- */}
        <section className="x4-section">
          <div className="x4-section__head">
            <h2>Recent Signal History</h2>
            <span className="x4-muted">Last {d.history.length} closed</span>
          </div>

          <div className="x4-table">
            <div className="x4-table__head">
              <span>PAIR</span>
              <span>DIR</span>
              <span>ENTRY</span>
              <span>EXIT</span>
              <span>RESULT</span>
              <span>PIPS</span>
              <span>CLOSED</span>
            </div>
            {d.history.map((h, i) => (
              <div className="x4-table__row" key={i}>
                <span className="x4-table__pair">{h.pair}</span>
                <span className={`x4-dir ${h.direction === "LONG" ? "long" : "short"}`}>{h.direction}</span>
                <span>{fmtPrice(h.entry)}</span>
                <span>{fmtPrice(h.exit)}</span>
                <span className={`x4-result x4-result--${h.result}`}>
                  {h.result === "win" ? "WIN" : h.result === "loss" ? "LOSS" : "B/E"}
                </span>
                <span className={h.pips >= 0 ? "up" : "down"}>
                  {h.pips >= 0 ? "+" : ""}
                  {h.pips}
                </span>
                <span className="x4-muted">{h.closedAt}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="x4-footer">
        <span className="x4-footer__brand">
          <strong>{d.brand}</strong> <span className="x4-muted">| {d.tagline}</span>
        </span>
        <span className="x4-muted">
          Status: <span className="x4-node-dot" /> ACTIVE NODE
        </span>
        <span className="x4-muted">© {new Date().getFullYear()} {d.brand}. All rights reserved.</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  foot,
  trend,
  pulse,
}: {
  label: string;
  value: string;
  sub: string;
  foot: string;
  trend?: "up" | "down" | "flat";
  pulse?: boolean;
}) {
  return (
    <div className="x4-card">
      <div className="x4-card__label">
        {label}
        {trend && trend !== "flat" && (
          <span className={`x4-card__trend ${trend}`}>{trend === "up" ? "▲" : "▼"}</span>
        )}
      </div>
      <div className={`x4-card__value ${pulse ? "x4-pulse-text" : ""}`}>{value}</div>
      <div className="x4-card__sub">{sub}</div>
      <div className="x4-card__foot">{foot}</div>
    </div>
  );
}

function ActiveSignalCard({ s }: { s: ActiveSignal }) {
  const [copiedLevel, setCopiedLevel] = useState<string | null>(null);
  const statusLabel =
    s.tradeStatus === "TP2_HIT"
      ? "TP2 secured - waiting for TP3"
      : s.tradeStatus === "TP1_HIT"
      ? "TP1 secured - waiting for TP2 / TP3"
      : s.status === "profit"
      ? `Live market +${s.statusPips ?? 0} pips`
      : s.status === "loss"
      ? `Live market -${s.statusPips ?? 0} pips`
      : "Live - waiting for TP1";

  const copyLevel = (label: string, value: number) => {
    navigator.clipboard.writeText(String(value));
    setCopiedLevel(label);
    setTimeout(() => setCopiedLevel(null), 1500);
  };

  return (
    <div className="x4-signal">
      <div className="x4-signal__top">
        <span className="x4-signal__pair">{s.pair}</span>
        <span className={`x4-dir ${s.direction === "LONG" ? "long" : "short"}`}>{s.direction}</span>
        {s.tier && <span className={`x4-tier x4-tier--${s.tier.toLowerCase()}`}>{s.tier}</span>}
        <span className="x4-muted x4-signal__time">{s.openedAgo}</span>
      </div>
      <div className="x4-signal__levels">
        <Level label="ENTRY" value={s.entry} copied={copiedLevel === "ENTRY"} onCopy={copyLevel} />
        <Level label="SL" value={s.sl} muted copied={copiedLevel === "SL"} onCopy={copyLevel} />
        <Level label="TP1" value={s.tp1} copied={copiedLevel === "TP1"} onCopy={copyLevel} />
        <Level label="TP2" value={s.tp2} copied={copiedLevel === "TP2"} onCopy={copyLevel} />
        {s.tp3 != null && <Level label="TP3" value={s.tp3} copied={copiedLevel === "TP3"} onCopy={copyLevel} />}
      </div>
      <div className={`x4-signal__status x4-signal__status--${s.status}`}>{statusLabel}</div>
    </div>
  );
}

function Level({
  label,
  value,
  muted,
  copied,
  onCopy,
}: {
  label: string;
  value: number;
  muted?: boolean;
  copied?: boolean;
  onCopy?: (label: string, value: number) => void;
}) {
  return (
    <div className={`x4-level ${muted ? "x4-level--muted" : ""}`}>
      <span className="x4-level__label">{label}</span>
      <span className="x4-level__row">
        <span className="x4-level__value">{fmtPrice(value)}</span>
        <button
          type="button"
          className={`x4-level__copy ${copied ? "copied" : ""}`}
          onClick={() => onCopy?.(label, value)}
          title={`Copy ${label}`}
        >
          {copied ? "✓" : "⧉"}
        </button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — design tokens live at the top; change these to re-theme
// ---------------------------------------------------------------------------

const CSS = `
:root {
  --x4-bg: #05080d;
  --x4-panel: rgba(14, 20, 30, 0.88);
  --x4-panel-2: rgba(18, 26, 38, 0.92);
  --x4-line: rgba(50, 63, 84, 0.62);
  --x4-text: #e7eaee;
  --x4-text-dim: #7c8794;
  --x4-amber: #ffb020;
  --x4-cyan: #4fd1e8;
  --x4-green: #33d17a;
  --x4-red: #ff5c5c;
  --x4-font-display: 'IBM Plex Sans', 'Segoe UI', sans-serif;
  --x4-font-mono: 'IBM Plex Mono', 'SF Mono', Consolas, monospace;
}

.x4-root {
  background:
    radial-gradient(circle at 12% 0%, rgba(0, 209, 255, 0.10), transparent 28%),
    radial-gradient(circle at 86% 10%, rgba(34, 197, 94, 0.08), transparent 26%),
    linear-gradient(180deg, #05080d 0%, #070b12 42%, #030509 100%);
  color: var(--x4-text);
  font-family: var(--x4-font-display);
  min-height: 100%;
  width: 100%;
}

.x4-muted { color: var(--x4-text-dim); }
.up { color: var(--x4-green); }
.down { color: var(--x4-red); }

/* Ticker */
.x4-ticker {
  overflow: hidden;
  white-space: nowrap;
  background: #000;
  border-bottom: 1px solid var(--x4-line);
  height: 28px;
  display: flex;
  align-items: center;
}
.x4-ticker__track {
  display: inline-flex;
  animation: x4-scroll 40s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .x4-ticker__track { animation: none; }
}
@keyframes x4-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
.x4-ticker__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  font-family: var(--x4-font-mono);
  font-size: 11px;
  border-right: 1px solid var(--x4-line);
}
.x4-ticker__pair { color: var(--x4-text-dim); letter-spacing: 0.5px; }
.x4-ticker__price { color: var(--x4-text); font-weight: 600; }
.x4-ticker__price--bull { color: var(--x4-green); }
.x4-ticker__price--bear { color: var(--x4-red); }
.x4-ticker__price--neutral { color: var(--x4-text); }
.x4-ticker__chg.up { color: var(--x4-green); }
.x4-ticker__chg.down { color: var(--x4-red); }

/* Header */
.x4-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  border-bottom: 1px solid var(--x4-line);
}
.x4-header__left, .x4-header__right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.x4-live-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--x4-green);
  box-shadow: 0 0 0 0 rgba(51,209,122,0.5);
  animation: x4-pulse-dot 2s infinite;
}
@keyframes x4-pulse-dot {
  0% { box-shadow: 0 0 0 0 rgba(51,209,122,0.55); }
  70% { box-shadow: 0 0 0 6px rgba(51,209,122,0); }
  100% { box-shadow: 0 0 0 0 rgba(51,209,122,0); }
}
.x4-brand {
  font-weight: 700;
  font-size: 17px;
  letter-spacing: -0.2px;
}
.x4-badge {
  font-family: var(--x4-font-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}
.x4-badge--live {
  background: rgba(51,209,122,0.12);
  color: var(--x4-green);
  border: 1px solid rgba(51,209,122,0.35);
}
.x4-divider {
  width: 1px; height: 16px; background: var(--x4-line);
}
.x4-session {
  color: var(--x4-cyan);
  font-family: var(--x4-font-mono);
  font-size: 12px;
  letter-spacing: 0.5px;
}
.x4-tradelog {
  font-family: var(--x4-font-mono);
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--x4-text-dim);
  border: 1px solid var(--x4-line);
  padding: 4px 10px;
  border-radius: 4px;
}
.x4-clock {
  font-family: var(--x4-font-mono);
  font-size: 12px;
  color: var(--x4-text-dim);
}

/* Weekend banner */
.x4-banner {
  background: rgba(255,176,32,0.08);
  border-bottom: 1px solid rgba(255,176,32,0.25);
  color: var(--x4-amber);
  font-size: 12px;
  padding: 8px 24px;
  display: flex;
  gap: 8px;
  font-family: var(--x4-font-mono);
}
.x4-banner__tag { font-weight: 700; letter-spacing: 0.5px; }

.x4-main {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

/* Stat cards */
.x4-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 900px) {
  .x4-stats { grid-template-columns: repeat(2, 1fr); }
}
.x4-card {
  background: var(--x4-panel);
  border: 1px solid var(--x4-line);
  border-radius: 6px;
  padding: 16px 18px;
}
.x4-card__label {
  font-family: var(--x4-font-mono);
  font-size: 11px;
  color: var(--x4-text-dim);
  letter-spacing: 0.8px;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.x4-card__trend.up { color: var(--x4-green); }
.x4-card__trend.down { color: var(--x4-red); }
.x4-card__value {
  font-family: var(--x4-font-mono);
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 6px;
}
.x4-pulse-text { color: var(--x4-cyan); }
.x4-card__sub {
  font-size: 12px;
  color: var(--x4-text-dim);
  padding-bottom: 10px;
  border-bottom: 1px solid var(--x4-line);
  margin-bottom: 8px;
}
.x4-card__foot {
  font-family: var(--x4-font-mono);
  font-size: 11px;
  color: var(--x4-text-dim);
}

/* Sections */
.x4-section__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}
.x4-section__head h2 {
  font-size: 15px;
  font-weight: 700;
  margin: 0;
}
.x4-count {
  font-family: var(--x4-font-mono);
  font-size: 11px;
  background: var(--x4-panel-2);
  border: 1px solid var(--x4-line);
  color: var(--x4-cyan);
  padding: 1px 7px;
  border-radius: 10px;
}

/* Empty state */
.x4-empty {
  background: var(--x4-panel);
  border: 1px solid var(--x4-line);
  border-radius: 6px;
  padding: 48px 24px;
  text-align: center;
}
.x4-empty__spinner {
  width: 28px; height: 28px;
  margin: 0 auto 16px;
  border-radius: 50%;
  border: 2px solid var(--x4-line);
  border-top-color: var(--x4-cyan);
  animation: x4-spin 0.9s linear infinite;
}
@keyframes x4-spin { to { transform: rotate(360deg); } }
.x4-empty__title { font-weight: 600; margin-bottom: 4px; }
.x4-empty__sub { font-size: 13px; color: var(--x4-text-dim); }

/* Active signal cards */
.x4-signals {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.x4-signal {
  background: var(--x4-panel);
  border: 1px solid var(--x4-line);
  border-left: 3px solid var(--x4-cyan);
  border-radius: 6px;
  padding: 14px 16px;
}
.x4-signal__top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.x4-signal__pair {
  font-weight: 700;
  font-family: var(--x4-font-mono);
}
.x4-dir {
  font-family: var(--x4-font-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}
.x4-dir.long { background: rgba(51,209,122,0.14); color: var(--x4-green); }
.x4-dir.short { background: rgba(255,92,92,0.14); color: var(--x4-red); }
.x4-tier {
  font-size: 10px;
  font-family: var(--x4-font-mono);
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid var(--x4-line);
  color: var(--x4-text-dim);
}
.x4-tier--strong { color: var(--x4-amber); border-color: rgba(255,176,32,0.4); }
.x4-signal__time { margin-left: auto; font-size: 11px; }
.x4-signal__levels {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0 16px;
}
.x4-level {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(42, 52, 68, 0.75);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(12, 18, 28, 0.92), rgba(7, 11, 18, 0.72));
}
.x4-level__label {
  display: block;
  font-size: 9px;
  color: var(--x4-text-dim);
  letter-spacing: 0.7px;
  margin-bottom: 5px;
}
.x4-level__value {
  display: block;
  font-family: var(--x4-font-mono);
  font-size: 13.5px;
  font-weight: 600;
  min-width: 0;
}
.x4-level__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.x4-level__copy {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  border: 1px solid var(--x4-line);
  background: rgba(8, 9, 11, 0.55);
  color: var(--x4-text-dim);
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.x4-level__copy:hover,
.x4-level__copy.copied {
  color: var(--x4-cyan);
  border-color: rgba(79, 209, 232, 0.45);
  background: rgba(79, 209, 232, 0.08);
}
.x4-level--muted .x4-level__value { color: var(--x4-red); }
.x4-signal__status {
  font-family: var(--x4-font-mono);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  margin-top: 10px;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  letter-spacing: 0.02em;
}
.x4-signal__status--profit { color: var(--x4-green); }
.x4-signal__status--loss { color: var(--x4-red); }
.x4-signal__status--pending {
  color: #5eead4;
  background: rgba(20,184,166,0.10);
  border-color: rgba(20,184,166,0.26);
  box-shadow: 0 0 20px rgba(20,184,166,0.06);
}
.x4-signal__status--pending::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #2dd4bf;
  box-shadow: 0 0 12px rgba(45,212,191,0.9);
}

/* Watchlist groups */
.x4-group { margin-bottom: 16px; }
.x4-group__label {
  font-family: var(--x4-font-mono);
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--x4-text-dim);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.x4-group__code {
  background: var(--x4-panel-2);
  border: 1px solid var(--x4-line);
  color: var(--x4-cyan);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
}
.x4-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.x4-row {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--x4-panel);
  border: 1px solid var(--x4-line);
  border-radius: 5px;
  padding: 10px 14px;
  transition: background 0.15s ease;
}
.x4-row:hover { background: var(--x4-panel-2); }
.x4-row__pair {
  font-weight: 700;
  font-family: var(--x4-font-mono);
  width: 90px;
}
.x4-row__price {
  font-family: var(--x4-font-mono);
  font-size: 14px;
  width: 110px;
}
.x4-row__chg {
  font-family: var(--x4-font-mono);
  font-size: 12px;
  width: 60px;
}
.x4-pill {
  margin-left: auto;
  font-family: var(--x4-font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 3px 9px;
  border-radius: 3px;
}
.x4-pill--bull { background: rgba(51,209,122,0.14); color: var(--x4-green); }
.x4-pill--bear { background: rgba(255,92,92,0.14); color: var(--x4-red); }
.x4-pill--neutral { background: var(--x4-panel-2); color: var(--x4-text-dim); border: 1px solid var(--x4-line); }

/* History table */
.x4-table {
  background: var(--x4-panel);
  border: 1px solid var(--x4-line);
  border-radius: 6px;
  overflow: hidden;
}
.x4-table__head, .x4-table__row {
  display: grid;
  grid-template-columns: 90px 70px 90px 90px 70px 70px 1fr;
  gap: 8px;
  padding: 10px 16px;
  align-items: center;
}
.x4-table__head {
  font-family: var(--x4-font-mono);
  font-size: 10px;
  color: var(--x4-text-dim);
  letter-spacing: 0.8px;
  border-bottom: 1px solid var(--x4-line);
}
.x4-table__row {
  font-family: var(--x4-font-mono);
  font-size: 13px;
  border-bottom: 1px solid var(--x4-line);
}
.x4-table__row:last-child { border-bottom: none; }
.x4-table__pair { font-weight: 700; }
.x4-result {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  width: fit-content;
}
.x4-result--win { background: rgba(51,209,122,0.14); color: var(--x4-green); }
.x4-result--loss { background: rgba(255,92,92,0.14); color: var(--x4-red); }
.x4-result--breakeven { background: var(--x4-panel-2); color: var(--x4-text-dim); }

/* Footer */
.x4-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-top: 1px solid var(--x4-line);
  font-size: 12px;
  flex-wrap: wrap;
  gap: 8px;
}
.x4-node-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--x4-green);
  margin: 0 4px;
}

@media (max-width: 640px) {
  .x4-signals { grid-template-columns: 1fr; }
  .x4-signal__levels { grid-template-columns: repeat(2, 1fr); }
  .x4-table__head, .x4-table__row { grid-template-columns: 1fr 1fr; }
  .x4-table__head span:nth-child(n+3), .x4-table__row span:nth-child(n+3) { display: none; }
}
`;
