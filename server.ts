import 'dotenv/config';
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { startScanner, scannerState, latestMarketState } from "./server/scanner.js";
import { rejectionStats } from "./server/engine.js";
import { supabase } from './server/supabase.js';

import { GoogleGenAI } from "@google/genai";

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
  }
});

process.on('unhandledRejection', (reason, promise) => {
  const err = reason as any;
  if (!err?.message?.includes('terminated')) {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
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
        .from('signal_audit_log')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(20);
      
      if (data) {
        recentSignals = data.map((d: any) => ({
          ...d,
          timestamp: d.generated_at,
          aiConfidence: d.confidence_score,
          score: d.confidence_score,
        }));
      }

      // Fetch authentic counts from Supabase database to avoid 20-item local limitation mismatch
      const { count: activeCount } = await supabase
        .from('signal_audit_log')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ACTIVE')
        .neq('tier', 'Reject');
      if (activeCount !== null) activeSignalsCount = activeCount;

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const { count: todayCount } = await supabase
        .from('signal_audit_log')
        .select('*', { count: 'exact', head: true })
        .gte('generated_at', startOfDay.toISOString())
        .neq('tier', 'Reject');
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
        .from('signal_audit_log')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(100);
      if (data) {
        res.json(data.map((d: any) => ({
          ...d,
          timestamp: d.generated_at,
          aiConfidence: d.confidence_score,
          score: d.confidence_score,
        })));
        return;
      }
    }
    res.json(scannerState.signals);
  });

  app.get("/api/today-signals", async (req, res) => {
    try {
      if (supabase) {
        // Fix: Use a rolling 24-hour window instead of UTC midnight 
        // to prevent dropping signals for users in non-UTC timezones
        const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        const { data, error } = await supabase
          .from('signals')
          .select('*')
          .gte('created_at', last24Hours.toISOString())
          .order('created_at', { ascending: false });
          
        if (error) {
          console.error("Supabase error fetching today signals:", error);
        } else if (data && data.length > 0) {
          return res.json(data.map((d: any) => ({
            ...d,
            entry: d.entry_price,
            timestamp: d.created_at,
            aiConfidence: d.confidence_score || d.confidence,
            score: d.confidence_score || d.confidence
          })));
        } else {
          // Fallback to active_opportunities if signal_audit_log is empty
          const todayStart = new Date();
          todayStart.setHours(0,0,0,0);
          
          const { data: oppsData, error: oppsError } = await supabase
            .from('active_opportunities')
            .select('*')
            .gte('updated_at', todayStart.toISOString())
            .order('updated_at', { ascending: false });
            
          if (!oppsError && oppsData && oppsData.length > 0) {
            return res.json(oppsData.map((d: any) => ({
              ...d,
              timestamp: d.updated_at,
              aiConfidence: d.confidence
            })));
          }
        }
      }
      
      // In-memory fallback
      const fallbackToday = new Date();
      fallbackToday.setUTCHours(0,0,0,0);
      const fallback = scannerState.signals
        .filter(s => s.tier !== 'Reject' && new Date(s.timestamp).getTime() >= fallbackToday.getTime())
        .map(s => ({
           ...s,
           aiConfidence: s.aiConfidence || s.score
        }))
        .reverse();
      res.json(fallback);
    } catch (e) {
      console.error("Route error:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
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
           tp1_hit_at: d.status === 'TP1 HIT' || d.status === 'TP2 HIT' || d.status === 'TP3 HIT' || d.status === 'CLOSED' ? new Date().toISOString() : null,
        }));
        openTrades = allTrades.filter((t: any) => t.is_active);
        closedTrades = allTrades.filter((t: any) => !t.is_active && t.result);
      }
    } else {
      // In-memory fallback
      allTrades = scannerState.signals.filter(s => s.tier !== 'Reject');
      openTrades = allTrades.filter(s => s.status !== 'CLOSED' && s.result !== 'LOSS' && s.result !== 'WIN');
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
        if (t.result === 'LOSS' || t.status === 'CLOSED' && t.result !== 'WIN') slHits++;

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

  const requireAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing authorization header" });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Invalid token" });
    
    const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
    if (!profile?.is_admin) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
    }
    
    (req as any).user = user;
    next();
  };

  app.post("/api/payments", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { email, network, txid } = req.body;
    
    // Ensure requester owns the data
    const user = (req as any).user;
    if (user.email !== email) {
        return res.status(403).json({ error: "Forbidden: You can only submit payments for your own account" });
    }

    const { error } = await supabase.from('payments').insert([{ user_id: user.id, email, proof_url: network, tx_hash: txid }]);
    if (error && error.message.includes('find the table')) {
      runtimePayments.push({ id: crypto.randomUUID(), email, network, txid, status: 'PENDING', created_at: new Date().toISOString() });
      return res.json({ success: true });
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.get("/api/payments", requireAdmin, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { data, error } = await supabase.from('payments').select('*').order('created_at', { ascending: false });
    if (error && error.message.includes('find the table')) {
      return res.json(runtimePayments);
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.get("/api/payments/:email/status", requireAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    
    const user = (req as any).user;
    const requestedEmail = req.params.email;
    if (user.email !== requestedEmail) {
        const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
        if (!profile?.is_admin) {
             return res.status(403).json({ error: "Forbidden: email mismatch" });
        }
    }
    const { data, error } = await supabase.from('payments').select('*').eq('email', req.params.email).order('created_at', { ascending: false }).limit(1);
    if (error && error.message.includes('find the table')) {
      const pm = runtimePayments.filter(p => p.email === req.params.email).sort((a,b) => b.created_at.localeCompare(a.created_at))[0];
      return res.json(pm || null);
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0] || null);
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

  app.get("/api/admin/users", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const authUsersRes = await supabase.auth.admin.listUsers();
    if (authUsersRes.error) return res.status(500).json({ error: authUsersRes.error.message });
    
    const { data: profiles } = await supabase.from('profiles').select('*');
    
    const combinedUsers = authUsersRes.data.users.map(u => {
       const profile = profiles?.find(p => p.id === u.id);
       return {
         ...profile,
         id: u.id,
         email: u.email,
         full_name: profile?.full_name || u.user_metadata?.full_name || '',
         avatar_url: profile?.avatar_url || u.user_metadata?.avatar_url || '',
         plan: profile?.plan || 'FREE',
         is_admin: profile?.is_admin || false,
         created_at: u.created_at,
       };
    });
    res.json(combinedUsers);
  });

  app.post("/api/admin/users/:id/plan", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "4x System Error" });
    const { id } = req.params;
    const { plan } = req.body;
    const { data, error } = await supabase.from('profiles').update({ plan }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.post("/api/admin/users/:id/delete", async (req, res) => {
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
