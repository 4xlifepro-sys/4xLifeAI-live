/**
 * ============================================================================
 * adaptCtraderData.ts
 * ============================================================================
 * Converts the raw /api/prices response (from live-market-feed.ts / cTrader)
 * into the `DashboardData` shape that Dashboard.tsx expects.
 *
 * HOW TO USE (for the coding agent):
 *   import { adaptCtraderData } from './adaptCtraderData';
 *   const raw = await fetch('/api/prices').then(r => r.json());
 *   const dashboardData = adaptCtraderData(raw, { activeSignals, history, stats });
 *   <Dashboard data={dashboardData} />
 *
 * This only handles the WATCHLIST portion (prices + trend) automatically.
 * Active signals, history, and stats still need to come from wherever your
 * scanner/backtest results are stored (Supabase, in-memory, etc.) — pass
 * them in as the second argument's overrides.
 * ============================================================================
 */

interface RawPriceItem {
  pair: string;
  price: number | null;
  digits: number | null;
  timestamp?: number;
  error?: string;
}

interface RawPricesResponse {
  prices: RawPriceItem[];
  cached?: boolean;
}

// Classify each pair into a watchlist group.
// Edit this list if you add/remove pairs later (e.g. the 50-pair expansion).
const PAIR_GROUPS: { code: string; label: string; test: (p: string) => boolean }[] = [
  { code: "MT", label: "METALS", test: (p) => p.startsWith("XAU") || p.startsWith("XAG") || p.startsWith("XPT") || p.startsWith("XPD") },
  { code: "CR", label: "CRYPTO", test: (p) => /^(BTC|ETH|SOL|XRP|BNB|ADA|LTC|DOT|DOGE|AVAX)USD$/.test(p) },
  { code: "FX", label: "FOREX", test: () => true }, // fallback — must be last
];

function groupForPair(pair: string) {
  return PAIR_GROUPS.find((g) => g.test(pair))!;
}

// Simple trend heuristic from price direction vs a reference.
// Replace this with your real engine's regime/bias output if available —
// this is only a placeholder so the UI has *something* to show if the
// scanner hasn't attached a trend field yet.
function inferTrend(pair: string, price: number, previousPrice?: number): "BULL" | "BEAR" | "NEUTRAL" {
  if (previousPrice == null) return "NEUTRAL";
  const diff = price - previousPrice;
  const threshold = price * 0.0002; // 0.02% — tune as needed
  if (diff > threshold) return "BULL";
  if (diff < -threshold) return "BEAR";
  return "NEUTRAL";
}

export interface AdapterOverrides {
  activeSignals?: any[]; // pass through from your scanner state
  history?: any[]; // pass through from your closed-trades log
  stats?: Partial<{
    winRate30d: number;
    signalsThisMonth: number;
    signalsSince: string;
    wins: number;
    losses: number;
    avgRR: number | null;
    totalPipsClosed: number;
  }>;
  session?: string;
  weekendMode?: string;
  previousPrices?: Record<string, number>; // last known prices, for trend inference
}

export function adaptCtraderData(raw: RawPricesResponse, overrides: AdapterOverrides = {}) {
  const groupsMap = new Map<string, { label: string; code: string; items: any[] }>();

  for (const item of raw.prices) {
    if (item.price == null || item.error) continue; // skip rate-limited/failed pairs

    const group = groupForPair(item.pair);
    if (!groupsMap.has(group.code)) {
      groupsMap.set(group.code, { label: group.label, code: group.code, items: [] });
    }

    const prevPrice = overrides.previousPrices?.[item.pair];
    const trend = inferTrend(item.pair, item.price, prevPrice);
    const changePct = prevPrice ? ((item.price - prevPrice) / prevPrice) * 100 : undefined;

    groupsMap.get(group.code)!.items.push({
      pair: item.pair,
      price: item.price,
      trend,
      changePct,
    });
  }

  // Order groups: Forex, Metals, Crypto (matches the original dashboard order)
  const orderedCodes = ["FX", "MT", "CR"];
  const watchlist = orderedCodes
    .map((code) => groupsMap.get(code))
    .filter((g): g is NonNullable<typeof g> => !!g);

  const activeSignals = overrides.activeSignals ?? [];
  const bullishCount = watchlist.flatMap((g) => g.items).filter((i) => i.trend === "BULL").length;
  const bearishCount = watchlist.flatMap((g) => g.items).filter((i) => i.trend === "BEAR").length;

  const stats = {
    winRate30d: overrides.stats?.winRate30d ?? 0,
    signalsThisMonth: overrides.stats?.signalsThisMonth ?? 0,
    signalsSince: overrides.stats?.signalsSince ?? "Since Jul 1",
    wins: overrides.stats?.wins ?? 0,
    losses: overrides.stats?.losses ?? 0,
    activeCount: activeSignals.length,
    bullishCount,
    bearishCount,
    avgRR: overrides.stats?.avgRR ?? null,
    totalPipsClosed: overrides.stats?.totalPipsClosed ?? 0,
  };

  return {
    brand: "4xFiveAI",
    tagline: "Premium Signal Intelligence",
    session: overrides.session ?? "LIVE SESSION",
    pairCount: raw.prices.length,
    weekendMode: overrides.weekendMode,
    clockUtc: new Date().toISOString().slice(11, 19) + " UTC",
    stats,
    activeSignals,
    watchlist,
    history: overrides.history ?? [],
  };
}
