export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketState {
  pair: string;
  direction: 'LONG' | 'SHORT' | 'NONE' | string;
  tier: string;
  timestamp: string;
  strengthScore?: number;
  momentumScore?: number;
  atrScore?: number;
  trendScore?: number;
  regime?: string;
  regimeReason?: string;
}

export interface PairScanStatus {
  pair: string;
  category: string;
  status: 'scanning' | 'success' | 'error';
  lastScanTime?: string;
  message?: string;
}

export interface Signal {
  id: string;
  pair: string;
  direction: 'LONG' | 'SHORT';
  bias: string; // e.g., 'BULLISH', 'BEARISH'
  score: number;
  tier: 'Strong' | 'Good' | 'Valid' | 'Reject';
  aiConfidence?: number;
  aiConfidenceIsFallback?: boolean;
  aiReason?: string;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  timestamp: string;
  created_at?: string;
  status?: string;
  rejection_reason?: string;
  is_active?: boolean;
  diagnostics?: any;
  result?: 'WIN' | 'PARTIAL WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';
  pips_won?: number;
  pips_lost?: number;
  closed_at?: string;
}

export interface Stats {
  scanCycles: number;
  lastScanDuration: number;
  lastScanTime: number | null;
  totalAssetsConfigured?: number;
  activeAssets?: number;
  totalScannedAssets?: number;
  scanError?: string;
  isDegraded?: boolean;
  consecutiveApiErrors?: number;
  mode?: 'forex' | 'crypto';
  lastSignalTimestamp?: string | null;
  lastTradeTimestamp?: string | null;
  telegramPushes?: number;
  duplicateEvents?: number;
  rateLimitRecoveries?: number;
  scannerStartTime?: number;
  totalScanDurationMs?: number;
}
