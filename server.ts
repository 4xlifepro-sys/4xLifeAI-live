import 'dotenv/config';
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { startScanner, scannerState, latestMarketState, rejectionStats } from "./server/scanner.js";
import { supabase } from './server/supabase.js';
import { sendTelegramMessage } from './server/telegram.js';

import { GoogleGenAI } from "@google/genai";

const adminAlertCooldown = new Map<string, number>();
let notificationsTableAvailable = true;

function escapeTelegramHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shouldSendAdminAlert(key: string, cooldownMs = 60000) {
  const now = Date.now();
  const lastSent = adminAlertCooldown.get(key) || 0;
  if (now - lastSent < cooldownMs) return false;
  adminAlertCooldown.set(key, now);
  return true;
}

// Notification helper - inserts into Supabase notifications table
async function sendNotification(userEmail: string, title: string, message: string, type: string = 'info') {
  if (!supabase || !notificationsTableAvailable) return;
  let userId: string | null = null;
  try {
    const { data: authUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const authUserList = ((authUsers as any)?.users || []) as Array<{ id: string; email?: string | null }>;
    const targetUser = authUserList.find(user => (user.email || '').toLowerCase() === userEmail.toLowerCase());
    userId = targetUser?.id || null;
  } catch (error: any) {
    console.error('Notification user lookup error:', error?.message || error);
  }

  const { error } = await supabase.from('notifications').insert([{
    user_id: userId,
    email: userEmail,
    title,
    message,
    type,
    is_read: false,
    created_at: new Date().toISOString()
  }]);
  if (error) {
    if (error.message.includes("Could not find the table 'public.notifications'")) {
      notificationsTableAvailable = false;
      console.warn('Notifications table missing; web notifications disabled until table is created.');
      return;
    }
    console.error('Notification insert error:', error.message);
  }
}

async function sendAdminWebNotification(title: string, message: string, type: string = 'system_alert') {
  if (!supabase || !notificationsTableAvailable) return;

  const { data: admins, error } = await supabase
    .from('users')
    .select('email')
    .eq('role', 'ADMIN');

  if (error || !admins?.length) {
    console.error('[ADMIN NOTIFY] Failed to load admins:', error?.message || 'No admins found');
    return;
  }

  const { data: authUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const rows = admins
    .map((admin: any) => {
      const authUserList = ((authUsers as any)?.users || []) as Array<{ id: string; email?: string | null }>;
      const authUser = authUserList.find(user => (user.email || '').toLowerCase() === String(admin.email || '').toLowerCase());
      if (!authUser?.id) return null;
      return {
        user_id: authUser.id,
        email: admin.email,
        title,
        message,
        type,
        is_read: false,
        created_at: new Date().toISOString()
      };
    })
    .filter(Boolean);

  if (!rows.length) return;

  const { error: insertError } = await supabase.from('notifications').insert(rows);
  if (insertError) {
    if (insertError.message.includes("Could not find the table 'public.notifications'")) {
      notificationsTableAvailable = false;
      console.warn('[ADMIN NOTIFY] Notifications table missing; web notifications disabled until table is created.');
      return;
    }
    console.error('[ADMIN NOTIFY] Web notification insert error:', insertError.message);
  }
}

async function notifyAdmin(title: string, message: string, type: string = 'system_alert', dedupeKey?: string) {
  const key = dedupeKey || `${type}:${title}:${message.slice(0, 80)}`;
  if (!shouldSendAdminAlert(key)) return;

  await Promise.allSettled([
    sendTelegramMessage(`<b>${escapeTelegramHtml(title)}</b>\n${escapeTelegramHtml(message)}`),
    sendAdminWebNotification(title, message, type)
  ]);
}

function getPrompts() {
  try {
    const data = fs.readFileSync(path.join(process.cwd(), 'prompts.json'), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {
      coach_system_instruction: "You are the 4xLifeAI Coach, an expert in Smart Money Concepts (SMC) and quantitative trading. You help users with risk management, position sizing, understanding market structure (BOS, CHoCH, Order Blocks, Liquidity Sweeps), and trading psychology. Keep responses concise, professional, and directly actionable. Avoid long generic paragraphs.",
      signal_explainer_prompt: "You are an expert forex trader. Explain this signal to a user in plain English:\nPair: ${signal.pair}\nDirection: ${signal.direction}\nConfidence Score: ${signal.aiConfidence}%\nStatus: ${signal.tier}\nMarket Regime: ${signal.diagnostics?.confidenceBreakdown?.regime === 5 ? 'Trending (Clean)' : 'Chop / Mixed'}\nWhy this triggered:\n- ATR, VWAP, EMA alignments were matched\n- Pullback and stochastic were confirmed\n- Stop Loss is well placed\n\nGive a short, punchy 2-3 sentence explanation of why this trade looks good and what market structure we are following. No fluffy intros. Keep it to the point."
    };
  }
}

function savePrompts(prompts: any) {
  fs.writeFileSync(path.join(process.cwd(), 'prompts.json'), JSON.stringify(prompts, null, 2), 'utf8');
}

async function ensureAdminUser() {
  if (!supabase) {
    console.warn('[AUTH] Admin bootstrap skipped: Supabase client is not configured.');
    return;
  }

  const adminEmail = (process.env.AUTH_ADMIN_EMAIL || '').trim();
  const adminPassword = (process.env.AUTH_ADMIN_PASSWORD || '').trim();

  if (!adminEmail || !adminPassword) {
    console.warn('[AUTH] Admin bootstrap skipped: AUTH_ADMIN_EMAIL or AUTH_ADMIN_PASSWORD is missing.');
    return;
  }

  const { data: userList, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    console.error('[AUTH] Failed to read Supabase auth users:', listError.message);
    return;
  }

  const users = ((userList as any)?.users || []) as Array<{
    id: string;
    email?: string | null;
    user_metadata?: Record<string, any>;
  }>;
  const existingUser = users.find(user => (user.email || '').toLowerCase() === adminEmail.toLowerCase());
  let adminUserId = existingUser?.id || null;

  if (!existingUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        full_name: 'Admin',
        role: 'admin'
      }
    });

    if (error || !data.user) {
      console.error('[AUTH] Failed to auto-create admin user:', error?.message || 'Unknown error');
      return;
    }

    adminUserId = data.user.id;
    console.log(`[AUTH] Admin user auto-created in Supabase users table: ${adminEmail}`);
  } else {
    const { error } = await supabase.auth.admin.updateUserById(existingUser.id, {
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        ...(existingUser.user_metadata || {}),
        full_name: existingUser.user_metadata?.full_name || 'Admin',
        role: 'admin'
      }
    });

    if (error) {
      console.error('[AUTH] Failed to sync admin password:', error.message);
      return;
    }

    console.log(`[AUTH] Admin user password synchronized in Supabase users table: ${adminEmail}`);
  }

  if (!adminUserId) {
    return;
  }

  const { error: profileError } = await supabase.from('profiles').upsert([{
    id: adminUserId,
    full_name: 'Admin',
    avatar_url: null,
    plan: 'FREE',
    is_admin: true
  }], { onConflict: 'id' });

  if (profileError) {
    console.error('[AUTH] Failed to ensure admin profile row:', profileError.message);
    return;
  }

  console.log(`[AUTH] Admin profile ensured in Supabase users table: ${adminEmail}`);
}

process.on('uncaughtException', (err) => {
  if (!err?.message?.includes('terminated')) {
    console.error('Uncaught Exception:', err);
    notifyAdmin('Server Exception', err?.message || String(err), 'server_error', `uncaught:${err?.message || String(err)}`)
      .catch(error => console.error('[ADMIN NOTIFY] Uncaught exception alert failed:', error?.message || error));
  }
});

process.on('unhandledRejection', (reason, promise) => {
  const err = reason as any;
  if (!err?.message?.includes('terminated')) {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    notifyAdmin('Unhandled Server Rejection', err?.message || String(reason), 'server_error', `unhandled:${err?.message || String(reason)}`)
      .catch(error => console.error('[ADMIN NOTIFY] Unhandled rejection alert failed:', error?.message || error));
  }
});

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Initialize Gemini
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  await ensureAdminUser();

  // Start the background scanner
  await startScanner();

  app.use(express.json());
  app.use((req, res, next) => {
    res.on('finish', () => {
      if (req.path.startsWith('/api/') && res.statusCode >= 500) {
        notifyAdmin(
          'API Error',
          `${req.method} ${req.path} returned ${res.statusCode}`,
          'api_error',
          `api-error:${req.method}:${req.path}:${res.statusCode}`
        ).catch(error => console.error('[ADMIN NOTIFY] API error alert failed:', error?.message || error));
      }
    });
    next();
  });

  // Health check endpoint for external monitoring (UptimeRobot, etc.)
  app.get("/api/health", (req, res) => {
    const lastScanAge = scannerState.stats.lastScanTime ? Date.now() - scannerState.stats.lastScanTime : -1;
    const isHealthy = lastScanAge >= 0 && lastScanAge < 30000; // Unhealthy if no scan in 30s

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? "ok" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      scanner: {
        isRunning: isHealthy,
        lastScanTime: scannerState.stats.lastScanTime ? new Date(scannerState.stats.lastScanTime).toISOString() : null,
        scansLastHour: scannerState.stats.scanCycles,
        activeSignals: scannerState.signals.length,
        isDegraded: scannerState.stats.isDegraded
      }
    });
  });

  app.post("/api/admin/notify-signup", async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const fullName = String(req.body?.fullName || 'New user').trim();

    if (!email) return res.status(400).json({ error: "Email is required" });

    await notifyAdmin(
      'New User Signup',
      `${fullName} signed up.\nEmail: ${email}`,
      'user_signup',
      `signup:${email}`
    );

    res.json({ success: true });
  });

  // API Routes
  // Real-time Event Stream (SSE) for zero-database overhead memory state
  app.get("/api/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendState = () => {
      res.write(`data: ${JSON.stringify({
        stats: scannerState.stats,
        pairStatuses: scannerState.pairStatuses,
        marketStates: Array.from(latestMarketState.values()).map(ms => {
          const st = scannerState.pairStatuses.find(p => p.pair === ms.pair);
          return { ...ms, status: st ? st.status : 'success' };
        }),
        rejectionStats,
        confidenceHistory: scannerState.confidenceHistory
      })}\n\n`);
    };

    // Send initial immediately
    sendState();

    // Send updates every second. (In memory, no DB cost)
    const intervalId = setInterval(sendState, 1000);

    req.on("close", () => {
      clearInterval(intervalId);
    });
  });

  app.get("/api/state", async (req, res) => {
    let recentSignals: any[] = [];
    let activeSignalsCount = 0;
    let signalsTodayCount = 0;
    const scannerSummary = {
      isRunning: false,
      lastScanTime: null as string | null,
      scansLastHour: 0,
      activeSignals: 0,
      isDegraded: false
    };

    if (supabase) {
      const { data } = await supabase
        .from('signals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (data) {
        recentSignals = data.map((d: any) => ({
          ...d,
          entry: d.entry_price,
          timestamp: d.created_at,
          aiConfidence: (d.confidence || 0) * 10,
          score: d.score || ((d.confidence || 0) * 10),
        }));
      }

      // Fetch authentic counts from Supabase database to avoid 20-item local limitation mismatch
      const { count: activeCount } = await supabase
        .from('signals')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .in('status', ['LIVE', 'TP1_HIT', 'TP2_HIT']);
      if (activeCount !== null) activeSignalsCount = activeCount;

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const { count: todayCount } = await supabase
        .from('signals')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfDay.toISOString())
        .neq('status', 'REJECTED_BY_ADMIN');
      if (todayCount !== null) signalsTodayCount = todayCount;

      const { data: activeOpps } = await supabase
        .from('active_opportunities')
        .select('*');
      
      if (activeOpps) {
         scannerState.activeOpportunities = activeOpps;
      }

    } else {
      recentSignals = scannerState.signals.slice(0, 20);
      const validMem = scannerState.signals.filter(s => s.tier !== 'Reject');
      activeSignalsCount = validMem.filter(s => s.status === 'ACTIVE').length;
      signalsTodayCount = validMem.filter(s => new Date(s.timestamp).toDateString() === new Date().toDateString()).length;
    }

    const lastScanAge = scannerState.stats.lastScanTime ? Date.now() - scannerState.stats.lastScanTime : -1;
    scannerSummary.isRunning = lastScanAge >= 0 && lastScanAge < 30000;
    scannerSummary.lastScanTime = scannerState.stats.lastScanTime ? new Date(scannerState.stats.lastScanTime).toISOString() : null;
    scannerSummary.scansLastHour = scannerState.stats.scanCycles;
    scannerSummary.activeSignals = scannerState.signals.length;
    scannerSummary.isDegraded = scannerState.stats.isDegraded;

    res.json({
        scanner: scannerSummary,
        opportunities: scannerState.activeOpportunities || [],
        stats: scannerState.stats,
        pairStatuses: scannerState.pairStatuses,
        latestSignal: recentSignals.find(s => s.status !== 'REJECTED' && s.tier !== 'Reject') || null,
        signals: recentSignals, 
        activeSignalsCount,
        signalsTodayCount,
        activeOpportunities: scannerState.activeOpportunities || [],
        marketStates: Array.from(latestMarketState.values()).map(ms => {
          const st = scannerState.pairStatuses.find(p => p.pair === ms.pair);
          return { ...ms, status: st ? st.status : 'success' };
        }),
        rejectionStats,
        confidenceHistory: scannerState.confidenceHistory
    });
  });

  app.get("/api/signals", async (req, res) => {
    if (supabase) {
      const { data } = await supabase
        .from('signals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (data) {
        res.json(data.map((d: any) => ({
          ...d,
          sl: d.original_sl ?? d.sl,
          entry: d.entry_price,
          timestamp: d.created_at,
          aiConfidence: (d.confidence || 0) * 10,
          score: d.score || ((d.confidence || 0) * 10),
        })));
        return;
      }
    }
    res.json(scannerState.signals);
  });

  app.get("/api/trades", async (req, res) => {
    let openTrades: any[] = [];
    let closedTrades: any[] = [];
    let allTrades: any[] = [];

    if (supabase) {
      const { data } = await supabase
        .from('signals')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (data) {
        allTrades = data.map((d: any) => ({
           ...d,
           opened_at: d.created_at,
           entry: d.entry_price,
        }));
        openTrades = allTrades.filter((t: any) => t.is_active);
        closedTrades = allTrades.filter((t: any) => !t.is_active && t.result);
      }
    } else {
      // In-memory fallback
      allTrades = scannerState.signals.filter(s => s.tier !== 'Reject');
      openTrades = allTrades.filter(s => ['LIVE', 'TP1_HIT', 'TP2_HIT'].includes(s.status));
      closedTrades = allTrades.filter(s => s.status === 'CLOSED' || s.result === 'LOSS' || s.result === 'WIN' || s.result === 'PARTIAL WIN');
    }

    // Process Stats
    const totalTrades = closedTrades.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let breakevenTrades = 0;

    let tp1Hits = 0;
    let tp2Hits = 0;
    let tp3Hits = 0;
    let slHits = 0;

    let grossPipsWon = 0;
    let grossPipsLost = 0;

    let bestTrade = 0;
    let worstTrade = 0;

    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    
    // Process chronologically to get streaks right
    const chronoClosed = [...closedTrades].sort((a: any, b: any) => 
        new Date(a.closed_at || a.opened_at || a.timestamp).getTime() - new Date(b.closed_at || b.opened_at || b.timestamp).getTime()
    );

    chronoClosed.forEach((t: any) => {
        const isWin = t.result === 'WIN' || t.result === 'PARTIAL WIN';
        const isLoss = t.result === 'LOSS';
        
        if (isWin) winningTrades++;
        if (isLoss) losingTrades++;
        if (!isWin && !isLoss) breakevenTrades++;

        if (t.tp1_hit_at || t.status === 'TP1 HIT' || t.status === 'TP2 HIT' || t.status === 'TP3 HIT' || t.result === 'PARTIAL WIN' || t.result === 'WIN') tp1Hits++;
        if (t.tp2_hit_at || t.status === 'TP2 HIT' || t.status === 'TP3 HIT' || t.result === 'WIN') tp2Hits++;
        if (t.tp3_hit_at || t.status === 'TP3 HIT' || (t.result === 'WIN' && t.status === 'CLOSED' && !t.tp2_hit_at)) tp3Hits++; // Best guess if exact level hit not saved
        if (t.result === 'LOSS' || (t.status === 'CLOSED' && t.result !== 'WIN' && t.result !== 'PARTIAL WIN' && t.result !== 'BREAKEVEN')) slHits++;

        const pWon = t.pips_won || 0;
        const pLost = t.pips_lost || 0;
        
        grossPipsWon += pWon;
        grossPipsLost += pLost;

        if (pWon > bestTrade) bestTrade = pWon;
        if (pLost > worstTrade) worstTrade = pLost;

        if (isWin) {
            currentWinStreak++;
            currentLossStreak = 0;
            if (currentWinStreak > consecutiveWins) consecutiveWins = currentWinStreak;
        } else if (isLoss) {
            currentLossStreak++;
            currentWinStreak = 0;
            if (currentLossStreak > consecutiveLosses) consecutiveLosses = currentLossStreak;
        }
    });

    const netPips = grossPipsWon - grossPipsLost;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const lossRate = totalTrades > 0 ? (losingTrades / totalTrades) * 100 : 0;
    
    const profitFactor = grossPipsLost > 0 ? (grossPipsWon / grossPipsLost) : (grossPipsWon > 0 ? 999 : 0);
    
    const averageWin = winningTrades > 0 ? (grossPipsWon / winningTrades) : 0;
    const averageLoss = losingTrades > 0 ? (grossPipsLost / losingTrades) : 0;
    
    const averageRR = averageLoss > 0 ? (averageWin / averageLoss) : (averageWin > 0 ? averageWin : 0);
    
    // Expectancy: (Win Rate * Average Win) - (Loss Rate * Average Loss)
    const expectancy = ((winRate / 100) * averageWin) - ((lossRate / 100) * averageLoss);

    const averageCycleDuration = scannerState.stats.scanCycles > 0 
        ? Math.round(scannerState.stats.totalScanDurationMs / scannerState.stats.scanCycles) 
        : 0;

    res.json({
      openTrades,
      closedTrades,
      tradeStats: {
        totalTrades,
        winningTrades,
        losingTrades,
        breakevenTrades,
        openTradesCount: openTrades.length,
        closedTradesCount: closedTrades.length,
        tp1Hits,
        tp2Hits,
        tp3Hits,
        slHits,
        grossPipsWon,
        grossPipsLost,
        netPips,
        winRate,
        lossRate,
        profitFactor,
        expectancy,
        averageWin,
        averageLoss,
        averageRR,
        bestTrade,
        worstTrade,
        consecutiveWins,
        consecutiveLosses
      },
      telemetry: {
        telegramPushes: scannerState.stats.telegramPushes,
        duplicateEvents: scannerState.stats.duplicateEvents,
        rateLimitRecoveries: scannerState.stats.rateLimitRecoveries,
        lastSignalTimestamp: scannerState.stats.lastSignalTimestamp,
        lastTradeTimestamp: scannerState.stats.lastTradeTimestamp,
        scannerUptime: Date.now() - scannerState.stats.scannerStartTime,
        averageCycleDuration
      }
    });
  });

  app.get("/api/market-state", (req, res) => {
    res.json({
      states: Array.from(latestMarketState.values())
    });
  });

  const priceCache: { timestamp: number; data: any } = { timestamp: 0, data: [] };
  const PRICE_CACHE_TTL = 5000;
  let symbolsCache: any[] | null = null;
  let symbolInfoCache: Record<string, any> = {};

  app.get("/api/prices", async (req, res) => {
    if (priceCache.data.length > 0 && Date.now() - priceCache.timestamp < PRICE_CACHE_TTL) {
      return res.json({ prices: priceCache.data, cached: true });
    }

    try {
      const liveModule: any = await import('./server/live-market-feed.js');
      const approved = [
        'XAUUSD',
        'BTCUSD',
        'SOLUSD',
        'GBPNZD',
        'CADJPY',
        'NZDJPY',
        'EURNZD',
        'USDCAD',
        'XAGUSD',
        'LTCUSD',
        'ETHUSD',
        'GBPAUD',
        'BNBUSD',
        'AUDUSD',
      ];

      // Get client once and cache symbols for all pairs
      const client = await liveModule.getClient();
      if (!symbolsCache) {
        symbolsCache = await client.getSymbols();
      }

      const results: any[] = [];
      for (const [index, pair] of approved.entries()) {
        try {
          const symbol = symbolsCache.find((item: any) => item.symbolName === pair || item.name === pair || item.symbol === pair);
          if (!symbol) {
            results.push({ pair, price: null, digits: null, timestamp: Date.now(), error: 'symbol_not_found' });
            continue;
          }
          const symbolId = symbol.symbolId;
          const trendbarResp = await client.raw.market.getTrendbars({
            symbolId,
            period: liveModule.TrendbarPeriod?.M1 ?? 1,
            count: 2
          });
          const bars = Array.isArray(trendbarResp) ? trendbarResp : trendbarResp?.trendbars || [];
          if (!bars.length) {
            results.push({ pair, price: null, digits: null, timestamp: Date.now(), error: 'no_trendbars' });
            continue;
          }
          const last = bars[bars.length - 1];
          if (!symbolInfoCache[pair]) {
            symbolInfoCache[pair] = await client.getSymbolInfo(pair).catch(() => null);
          }
          const full = symbolInfoCache[pair];
          const digits = Number(full?.digits ?? symbol?.digits ?? 5);
          const decoded = liveModule.decodeTrendbar(last, digits);
          if (decoded && Number.isFinite(decoded.close)) {
            results.push({ pair, price: decoded.close, digits, timestamp: Date.now() });
          } else {
            results.push({ pair, price: null, digits, timestamp: Date.now(), error: 'invalid_close' });
          }
        } catch (itemError: any) {
          results.push({ pair, price: null, digits: null, timestamp: Date.now(), error: itemError?.message || 'pair_failed' });
        }
        if (index !== approved.length - 1) {
          await new Promise(r => setTimeout(r, 35));
        }
      }

      priceCache.timestamp = Date.now();
      priceCache.data = results;
      res.json({ prices: results, cached: false });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch prices', message: error?.message || String(error) });
    }
  });

  app.get("/api/config", (req, res) => {
    res.json({
      USDT_TRC20_ADDRESS: process.env.USDT_TRC20_ADDRESS || "TN3zCR5gACd16f7iDJH97GMB7mKRg3opXe",
      USDT_BEP20_ADDRESS: process.env.USDT_BEP20_ADDRESS || "0xa061175dd8cd00a87ae55d29a3fc7c31f8cb476a"
    });
  });

  // Payments API
  const runtimePayments: any[] = [];
  const runtimePayouts: any[] = [];
  const runtimeReferralBalances: Record<string, any> = {};

  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing authorization header" });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Invalid token" });
    
    (req as any).user = user;
    next();
  };

  app.get("/api/today-signals", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      
      // Get user plan and scan limit
      let planStatus = 'FREE';
      let scanLimit: number | null = null;
      if (supabase) {
        const { data: userRecord } = await supabase
          .from('users')
          .select('plan_status, credits')
          .eq('email', user.email)
          .single();
        planStatus = (userRecord?.plan_status || 'FREE').toUpperCase();
        
        // Fetch scan_limit from plans table
        const { data: planRecord } = await supabase
          .from('plans')
          .select('scan_limit')
          .ilike('name', planStatus === 'FREE' ? 'Free' : planStatus === 'PRO' ? 'Pro' : '%')
          .single();
        scanLimit = planRecord?.scan_limit ?? null;
      }
      
      const isPremium = planStatus === 'PRO' || planStatus === 'PREMIUM' || planStatus === 'ELITE' || planStatus === 'PAID';
      
      let signalsList: any[] = [];
      
      if (supabase) {
        // Keep "today" rows AND always include currently active trades
        const startOfTodayUtc = new Date();
        startOfTodayUtc.setUTCHours(0, 0, 0, 0);

        const [{ data: todayData, error: todayError }, { data: activeData, error: activeError }] = await Promise.all([
          supabase
            .from('signals')
            .select('*')
            .gte('created_at', startOfTodayUtc.toISOString())
            .order('created_at', { ascending: false }),
          supabase
            .from('signals')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false }),
        ]);

        if (todayError) {
          console.error("Supabase error fetching today signals:", todayError);
        }
        if (activeError) {
          console.error("Supabase error fetching active signals:", activeError);
        }

        const merged = new Map<any, any>();
        for (const row of todayData || []) merged.set(row.id, row);
        for (const row of activeData || []) merged.set(row.id, row);
        signalsList = Array.from(merged.values()).sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }
      
      // In-memory fallback
      if (signalsList.length === 0) {
        const fallbackToday = new Date();
        fallbackToday.setUTCHours(0,0,0,0);
        signalsList = scannerState.signals
          .filter(s => s.tier !== 'Reject' && new Date(s.timestamp).getTime() >= fallbackToday.getTime())
          .reverse();
      }
      
      // Enforce Free plan scan limit only when not explicitly disabled (e.g. dashboard overview)
      let limitInfo = { limited: false, limit: scanLimit, viewed: 0, remaining: null as number | null };
      const noLimit = req.query.noLimit === '1' || req.query.noLimit === 'true';
      
      if (!noLimit && !isPremium && scanLimit !== null && scanLimit > 0 && supabase) {
        const today = new Date().toISOString().split('T')[0];
        
        // Count unique signals viewed today
        const { count, error: countError } = await supabase
          .from('user_signal_views')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('view_date', today);
        
        if (countError) {
          console.error('Error counting signal views:', countError.message);
        }
        
        const viewed = count || 0;
        const remaining = Math.max(0, scanLimit - viewed);
        limitInfo = { limited: true, limit: scanLimit, viewed, remaining };
        
        // Record views for signals being returned
        const toRecord = signalsList.slice(0, remaining);
        if (toRecord.length > 0) {
          const inserts = toRecord.map((s: any) => ({
            user_id: user.id,
            view_date: today,
            signal_id: s.id,
          }));
          // Insert one by one, ignore duplicates
          for (const insert of inserts) {
            await supabase.from('user_signal_views').insert([insert]).catch(() => {});
          }
        }
        
        // Slice to remaining limit
        signalsList = signalsList.slice(0, remaining);
      }
      
      const mapped = signalsList.map((d: any) => ({
        id: d.id,
        pair: d.pair,
        direction: d.direction,
        entry: d.entry_price,
        entry_price: d.entry_price,
        sl: d.original_sl ?? d.sl,
        original_sl: d.original_sl,
        tp1: d.tp1,
        tp2: d.tp2,
        tp3: d.tp3,
        confidence: d.confidence,
        aiConfidence: (d.confidence || 0) * 10,
        score: d.score || d.confidence,
        status: d.status,
        is_active: d.is_active,
        result: d.result,
        pips_won: d.pips_won,
        pips_lost: d.pips_lost,
        closed_at: d.closed_at,
        created_at: d.created_at,
        timestamp: d.created_at,
        tp1_hit_at: d.tp1_hit_at,
        tp2_hit_at: d.tp2_hit_at,
        tp3_hit_at: d.tp3_hit_at
      }));
      
      res.json({
        signals: mapped,
        limit: limitInfo,
      });
    } catch (e) {
      console.error("Route error:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Recent closed signals for dashboard history (auth required)
  app.get("/api/recent-closed-signals", requireAuth, async (req, res) => {
    try {
      if (!supabase) return res.json({ signals: [] });
      
      const { data, error } = await supabase
        .from('signals')
        .select('*')
        .eq('is_active', false)
        .in('status', ['CLOSED', 'STOP_LOSS_HIT', 'TP3_HIT'])
        .order('closed_at', { ascending: false })
        .limit(20);
      
      if (error) {
        console.error("Error fetching recent closed signals:", error.message);
        return res.status(500).json({ error: error.message });
      }
      
      const mapped = (data || []).map((d: any) => ({
        id: d.id,
        pair: d.pair,
        direction: d.direction,
        entry: d.entry_price,
        entry_price: d.entry_price,
        sl: d.original_sl ?? d.sl,
        original_sl: d.original_sl,
        tp1: d.tp1,
        tp2: d.tp2,
        tp3: d.tp3,
        confidence: d.confidence,
        aiConfidence: (d.confidence || 0) * 10,
        score: d.score || d.confidence,
        status: d.status,
        is_active: d.is_active,
        result: d.result,
        pips_won: d.pips_won,
        pips_lost: d.pips_lost,
        closed_at: d.closed_at,
        created_at: d.created_at,
        timestamp: d.created_at,
      }));
      
      res.json({ signals: mapped });
    } catch (e) {
      console.error("Route error:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  const requireAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing authorization header" });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Invalid token" });
    
    // Check our users table for role = 'ADMIN'
    const { data: userRecord } = await supabase.from('users').select('role').eq('email', user.email).single();
    if (!userRecord || userRecord.role !== 'ADMIN') {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
    }
    
    (req as any).user = user;
    next();
  };

  app.post("/api/payments", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { email, network, txid, plan, amount_usd, credits } = req.body;
    const user = (req as any).user;

    if (user.email !== email) {
      return res.status(403).json({ error: "Forbidden: You can only submit payments for your own account" });
    }

    const cleanTxid = String(txid || '').trim();
    if (!cleanTxid) return res.status(400).json({ error: "Transaction hash is required" });

    const selectedPlan = String(plan || 'PREMIUM').toUpperCase();
    const amount = Number(amount_usd || (selectedPlan === 'ELITE' ? 50 : 20));
    const planCredits = Number(credits || (selectedPlan === 'ELITE' ? 100 : 25));
    const methodValue = (network || 'TRC20').toUpperCase();
    const payload = {
      email: user.email,
      method: methodValue === 'BEP20' ? 'USDT_BEP20' : 'USDT_TRC20',
      plan: selectedPlan,
      amount_usd: amount,
      credits: planCredits,
      destination: cleanTxid,
      tx_hash: cleanTxid,
      status: 'PENDING'
    };

    let insert = await supabase.from('payment_intents').insert([payload]).select('*').single();
    if (insert.error && insert.error.message.includes("'tx_hash' column")) {
      const { tx_hash, ...fallbackPayload } = payload;
      insert = await supabase.from('payment_intents').insert([fallbackPayload]).select('*').single();
    }

    if (insert.error) return res.status(500).json({ error: insert.error.message });

    await sendNotification(user.email, 'Payment Submitted', `We received your payment. Our team will review and activate your account within 24 hours.`, 'payment');
    await notifyAdmin(
      'New Payment Submitted',
      `${user.email} submitted ${selectedPlan} payment.\nMethod: ${payload.method}\nAmount: $${amount}\nCredits: ${planCredits}\nTXID: ${cleanTxid}`,
      'payment_submitted',
      `payment-submitted:${insert.data?.id || cleanTxid}`
    );
    res.json({ success: true, payment: insert.data });
  });

  app.get("/api/payments", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { data, error } = await supabase.from('payment_intents').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map((payment: any) => ({
      ...payment,
      amount: payment.amount_usd,
      network: payment.method,
      proof_url: payment.method,
      tx_hash: payment.tx_hash || payment.destination,
      txid: payment.tx_hash || payment.destination
    })));
  });

  app.get("/api/payments/:email/status", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    
    const user = (req as any).user;
    const requestedEmail = req.params.email;
    if (user.email !== requestedEmail) {
      const { data: userRecord } = await supabase.from('users').select('role').eq('email', user.email).single();
      if (userRecord?.role !== 'ADMIN') {
        return res.status(403).json({ error: "Forbidden: email mismatch" });
      }
    }
    const { data, error } = await supabase.from('payment_intents').select('*').eq('email', req.params.email).order('created_at', { ascending: false }).limit(1);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0] || null);
  });

  // Admin: approve payment and send notification
  app.post("/api/admin/payments/:id/approve", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const paymentId = req.params.id;
    const { data: payment, error: paymentError } = await supabase.from('payment_intents').select('*').eq('id', paymentId).single();
    if (paymentError || !payment) return res.status(404).json({ error: 'Payment not found' });

    const { error: paymentUpdateError } = await supabase.from('payment_intents').update({ status: 'CONFIRMED' }).eq('id', paymentId);
    if (paymentUpdateError) return res.status(500).json({ error: paymentUpdateError.message });

    const { data: existingUser } = await supabase.from('users').select('credits').eq('email', payment.email).single();
    const nextCredits = Number(existingUser?.credits || 0) + Number(payment.credits || 0);
    const { error: userUpdateError } = await supabase
      .from('users')
      .update({ plan_status: payment.plan || 'PREMIUM', credits: nextCredits })
      .eq('email', payment.email);
    if (userUpdateError) return res.status(500).json({ error: userUpdateError.message });

    await sendNotification(payment.email, 'Payment Approved', `Congratulations! Your subscription is now active. You have full access to all trading signals and premium features. Welcome to 4xLifeAI!`, 'success');
    await notifyAdmin(
      'Payment Confirmed',
      `${payment.email} was approved.\nPlan: ${payment.plan || 'PREMIUM'}\nCredits added: ${payment.credits || 0}\nNew credits: ${nextCredits}`,
      'payment_confirmed',
      `payment-confirmed:${paymentId}`
    );

    res.json({ success: true });
  });

  // Admin: reject payment and send notification
  app.post("/api/admin/payments/:id/reject", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const paymentId = req.params.id;
    const { data: payment, error: paymentError } = await supabase.from('payment_intents').select('*').eq('id', paymentId).single();
    if (paymentError || !payment) return res.status(404).json({ error: 'Payment not found' });

    const { error: updateError } = await supabase.from('payment_intents').update({ status: 'REJECTED' }).eq('id', paymentId);
    if (updateError) return res.status(500).json({ error: updateError.message });

    await sendNotification(payment.email, 'Payment Review Update', `We were unable to verify your payment. Please check your transaction details and contact support if you believe this is an error.`, 'warning');
    await notifyAdmin(
      'Payment Rejected',
      `${payment.email} payment was rejected.\nPlan: ${payment.plan || 'N/A'}\nTXID: ${payment.tx_hash || payment.destination || 'N/A'}`,
      'payment_rejected',
      `payment-rejected:${paymentId}`
    );

    res.json({ success: true });
  });



  // Referrals API
  app.get("/api/referrals", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const user = (req as any).user;
    const email = user.email;
    
    let { data, error } = await supabase.from('referral_balances').select('*').eq('email', email).single();
    
    if (error && error.message.includes('find the table')) {
       return res.json({
          balance: runtimeReferralBalances[email]?.balance || 0,
          paid_referrals: runtimeReferralBalances[email]?.paid_referrals || 0,
          payouts: runtimePayouts.filter(p => p.email === email).sort((a,b) => b.created_at.localeCompare(a.created_at))
       });
    }

    if (error || !data) {
        await supabase.from('referral_balances').upsert([{ email: email, balance: 0, paid_referrals: 0 }]);
        const fresh = await supabase.from('referral_balances').select('*').eq('email', email).single();
        data = fresh.data;
    }
    
    const { data: payouts } = await supabase.from('payout_requests').select('*').eq('email', email).order('created_at', { ascending: false });
    
    res.json({
        balance: data?.balance || 0,
        paid_referrals: data?.paid_referrals || 0,
        payouts: payouts || []
    });
  });

  app.post("/api/referrals/claim", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const user = (req as any).user;
    const email = user.email;

    let { data, error: refError } = await supabase.from('referral_balances').select('*').eq('email', email).single();
    
    if (refError && refError.message.includes('find the table')) {
       const balance = runtimeReferralBalances[email]?.balance || 0;
       if (balance <= 0) return res.status(400).json({ error: "No balance to claim" });
       runtimePayouts.push({ id: crypto.randomUUID(), email: email, amount: balance, status: 'PENDING', created_at: new Date().toISOString() });
       return res.json({ success: true });
    }

    const balance = data?.balance || 0;
    
    if (balance <= 0) return res.status(400).json({ error: "No balance to claim" });
    
    const { error } = await supabase.from('payout_requests').insert([{ email: email, amount: balance }]);
    if (error) return res.status(500).json({ error: error.message });
    
    res.json({ success: true });
  });

  app.post("/api/support", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { user_id, email, subject, message } = req.body;
    
    // We embed email in the message so admin knows who it's from since table may lack email column
    const enrichedMessage = email ? `Contact Email: ${email}\n\n${message}` : message;
    const payload: any = { subject, message: enrichedMessage };
    if (user_id) payload.user_id = user_id;

    const { error } = await supabase.from('support_tickets').insert([payload]);
    
    if (error) {
       console.error("Support insert error:", error);
       return res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  });

  app.use("/api/admin", requireAdmin);

  app.get("/api/admin/prompts", async (req, res) => {
    try {
      res.json(getPrompts());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/prompts", async (req, res) => {
    try {
      const { coach_system_instruction, signal_explainer_prompt } = req.body;
      if (!coach_system_instruction || !signal_explainer_prompt) {
        return res.status(400).json({ error: "Missing required prompt configurations" });
      }
      savePrompts({ coach_system_instruction, signal_explainer_prompt });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/tickets/:id/mark-read", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { id } = req.params;
    const { error } = await supabase.from('support_tickets').update({ status: 'READ' }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.get("/api/admin/payouts", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { data, error } = await supabase.from('payout_requests').select('*').order('created_at', { ascending: false });
    if (error && error.message.includes('find the table')) {
       return res.json(runtimePayouts.sort((a,b) => b.created_at.localeCompare(a.created_at)));
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/admin/payouts/:id/mark-paid", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { data: payout, error: payoutError } = await supabase.from('payout_requests').select('*').eq('id', req.params.id).single();
    
    if (payoutError && payoutError.message.includes('find the table')) {
       const p = runtimePayouts.find(x => x.id === req.params.id);
       if (!p) return res.status(404).json({ error: "Not found" });
       if (p.status !== 'PAID') {
          p.status = 'PAID';
          if (runtimeReferralBalances[p.email]) {
            runtimeReferralBalances[p.email].balance = Math.max(0, runtimeReferralBalances[p.email].balance - p.amount);
          }
       }
       return res.json({ success: true });
    }

    if (!payout) return res.status(404).json({ error: "Not found" });
    
    if (payout.status !== 'PAID') {
        const { error: updateError } = await supabase.from('payout_requests').update({ status: 'PAID' }).eq('id', req.params.id);
        const { data: refData } = await supabase.from('referral_balances').select('*').eq('email', payout.email).single();
        if (refData) {
            await supabase.from('referral_balances').update({ balance: Math.max(0, refData.balance - payout.amount) }).eq('email', payout.email);
        }
        res.json({ success: true });
    } else {
        res.json({ success: true });
    }
  });

  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const authUsersRes = await supabase.auth.admin.listUsers();
    if (authUsersRes.error) return res.status(500).json({ error: authUsersRes.error.message });
    
    const { data: users } = await supabase.from('users').select('*');
    
    const combinedUsers = authUsersRes.data.users.map(u => {
       const userRecord = users?.find(p => p.id === u.id || p.email === u.email);
       return {
         ...userRecord,
         id: u.id,
         email: u.email,
         full_name: userRecord?.full_name || u.user_metadata?.full_name || '',
         avatar_url: userRecord?.avatar_url || u.user_metadata?.avatar_url || '',
         plan: userRecord?.plan_status || userRecord?.plan || 'FREE',
         credits: userRecord?.credits || 0,
         is_admin: userRecord?.role === 'ADMIN',
         created_at: u.created_at,
       };
    });
    res.json(combinedUsers);
  });

  app.post("/api/admin/users/:id/plan", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { id } = req.params;
    const { plan } = req.body;
    const authUsersRes = await supabase.auth.admin.getUserById(id);
    if (authUsersRes.error || !authUsersRes.data.user?.email) return res.status(404).json({ error: "User not found" });
    const { error } = await supabase.from('users').update({ plan_status: plan }).eq('email', authUsersRes.data.user.email);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.post("/api/admin/users/:id/delete", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { id } = req.params;
    const { data, error } = await supabase.auth.admin.deleteUser(id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { prompt, history } = req.body;
      
      const contents = history.map((msg: any) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
      contents.push({ role: 'user', parts: [{ text: prompt }] });

      const prompts = getPrompts();

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          systemInstruction: prompts.coach_system_instruction,
        }
      });
      
      res.json({ success: true, text: response.text });
    } catch (e: any) {
      let errorMessage = 'Failed to get AI response';
      
      if (e.message && e.message.includes('429')) {
          errorMessage = '4xLifeAI Coach is currently experiencing high demand. Please try again in 1 minute.';
      } else if (e.status === 429) {
          errorMessage = '4xLifeAI Coach is currently experiencing high demand. Please try again in 1 minute.';
      } else if (e.message) {
          errorMessage = e.message;
      }

      res.status(500).json({ error: errorMessage });
    }
  });

  // Test-only route to trigger notifications
  app.post("/api/test/trigger-notification", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Not allowed in production environment" });
    }

    try {
      if (!supabase) return res.status(500).json({ error: "4x System Error" });

      const { data: profiles } = await supabase.from('profiles').select('id');
      if (!profiles || profiles.length === 0) return res.status(404).json({ error: "No user profiles found to send notifications to" });

      const testNotifications = [];
      const timestamp = new Date().toISOString();

      for (const profile of profiles) {
         testNotifications.push({
             user_id: profile.id,
             title: 'New Premium Signal',
             message: 'Signal generated for EURUSD (LONG). Score: 12/14. Confidence: 89%.',
             created_at: timestamp
         });
         testNotifications.push({
             user_id: profile.id,
             title: 'Payment Approved',
             message: 'Your payment (TX123456789) has been approved. Subscription activated!',
             created_at: timestamp
         });
         testNotifications.push({
             user_id: profile.id,
             title: 'New Trade Signal',
             message: 'Signal generated for GBPUSD (SHORT)',
             created_at: timestamp
         });
         testNotifications.push({
             user_id: profile.id,
             title: 'Support Ticket Resolved',
             message: 'Your support ticket "Cannot access Elite Scanners" has been resolved.',
             created_at: timestamp
         });
      }

      const { error } = await supabase.from('notifications').insert(testNotifications);
      if (error) throw error;

      res.json({ success: true, message: `Inserted 4 test notifications for ${profiles.length} users.` });
    } catch (e: any) {
      console.error("Error inserting test notifications:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // For Express 4.x
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
