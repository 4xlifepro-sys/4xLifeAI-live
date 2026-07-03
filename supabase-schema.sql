CREATE TABLE IF NOT EXISTS public.active_opportunities (
    id text PRIMARY KEY,
    pair text NOT NULL,
    direction text NOT NULL,
    entry double precision NOT NULL,
    sl double precision NOT NULL,
    original_sl double precision,
    tp1 double precision NOT NULL,
    tp2 double precision NOT NULL,
    tp3 double precision NOT NULL,
    confidence integer,
    status text DEFAULT 'ACTIVE',
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.trades (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    pair text NOT NULL,
    direction text NOT NULL,
    entry double precision NOT NULL,
    sl double precision NOT NULL,
    original_sl double precision,
    tp1 double precision NOT NULL,
    tp2 double precision NOT NULL,
    tp3 double precision NOT NULL,
    confidence integer,
    grade text,
    status text DEFAULT 'ACTIVE',
    opened_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    closed_at timestamp with time zone,
    result text,
    pips_won double precision DEFAULT 0,
    pips_lost double precision DEFAULT 0,
    tp1_hit_at timestamp with time zone,
    tp2_hit_at timestamp with time zone,
    tp3_hit_at timestamp with time zone,
    sl_hit_at timestamp with time zone,
    is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.trade_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    trade_id uuid references public.trades(id) on delete cascade,
    event_type text NOT NULL,
    price double precision NOT NULL,
    pips double precision,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.trade_statistics (
    id integer PRIMARY KEY DEFAULT 1,
    total_trades integer DEFAULT 0,
    winning_trades integer DEFAULT 0,
    losing_trades integer DEFAULT 0,
    breakeven_trades integer DEFAULT 0,
    tp1_hits integer DEFAULT 0,
    tp2_hits integer DEFAULT 0,
    tp3_hits integer DEFAULT 0,
    sl_hits integer DEFAULT 0,
    gross_pips_won double precision DEFAULT 0,
    gross_pips_lost double precision DEFAULT 0,
    net_pips double precision DEFAULT 0,
    best_trade double precision DEFAULT 0,
    worst_trade double precision DEFAULT 0,
    consecutive_wins integer DEFAULT 0,
    consecutive_losses integer DEFAULT 0,
    current_win_streak integer DEFAULT 0,
    current_loss_streak integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.signal_audit_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    pair text NOT NULL,
    status text NOT NULL,
    tier text,
    direction text,
    entry double precision,
    sl double precision,
    tp1 double precision,
    tp2 double precision,
    tp3 double precision,
    raw_4h_open double precision,
    raw_4h_close double precision,
    raw_4h_start_time text,
    raw_5m_open double precision,
    raw_5m_close double precision,
    raw_5m_start_time text,
    pullback_high double precision,
    pullback_low double precision,
    confidence_score integer,
    confidence_breakdown jsonb,
    rejection_reason text,
    generated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    filtered_at timestamp with time zone,
    evaluated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    status_changed_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    momentum_score integer,
    volatility_score integer,
    final_score integer
);

ALTER TABLE public.signal_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access audit log" ON public.signal_audit_log FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Signal Results Tracking for ICT Validation
CREATE TABLE IF NOT EXISTS public.signal_results (
    id text PRIMARY KEY,
    pair text,
    direction text,
    tier text,
    score integer,
    
    entry double precision,
    sl double precision,
    tp1 double precision,
    tp2 double precision,
    tp3 double precision,
    
    tp1_hit boolean DEFAULT false,
    tp2_hit boolean DEFAULT false,
    tp3_hit boolean DEFAULT false,
    sl_hit boolean DEFAULT false,
    status text DEFAULT 'ACTIVE',
    rr_achieved double precision DEFAULT 0,
    
    result text, -- e.g. WIN_TP1, WIN_TP2, WIN_TP3, LOSS, BREAK_EVEN
    
    created_at timestamp with time zone,
    closed_at timestamp with time zone,
    
    sweep_type text,
    sweep_level double precision,
    sweep_index integer,
    
    mss_index integer,
    mss_break_level double precision,
    
    displacement_index integer,
    displacement_atr double precision,
    displacement_body double precision,
    
    fvg_index integer,
    fvg_top double precision,
    fvg_bottom double precision,
    
    order_block_index integer,
    order_block_high double precision,
    order_block_low double precision
);


CREATE TABLE IF NOT EXISTS public.scanner_stats (
    id integer PRIMARY KEY,
    "eliteSignals" integer DEFAULT 0,
    "tradeSignals" integer DEFAULT 0,
    "watchlist" integer DEFAULT 0,
    "rejected" integer DEFAULT 0,
    "scanCycles" integer DEFAULT 0,
    "lastScanDuration" integer DEFAULT 0,
    "lastScanTime" bigint
);

CREATE TABLE IF NOT EXISTS public.signals (
    id text PRIMARY KEY,
    pair text,
    direction text,
    bias text,
    score integer,
    tier text,
    "aiConfidence" integer,
    "aiReason" text,
    entry double precision,
    sl double precision,
    tp1 double precision,
    tp2 double precision,
    tp3 double precision,
    timestamp timestamp with time zone,
    status text DEFAULT 'ACTIVE',
    is_active boolean DEFAULT true
);

-- Add tracking columns for older setups
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS status text DEFAULT 'ACTIVE';
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS result text;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS pips_won double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS pips_lost double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS sl double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS tp1 double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS tp2 double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS tp3 double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS tp1_hit_at timestamp with time zone;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS tp2_hit_at timestamp with time zone;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS tp3_hit_at timestamp with time zone;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS original_sl double precision;

ALTER TABLE public.signal_audit_log ADD COLUMN IF NOT EXISTS tp1_hit_at timestamp with time zone;
ALTER TABLE public.signal_audit_log ADD COLUMN IF NOT EXISTS tp2_hit_at timestamp with time zone;
ALTER TABLE public.signal_audit_log ADD COLUMN IF NOT EXISTS tp3_hit_at timestamp with time zone;
ALTER TABLE public.signal_audit_log ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS strategy_version TEXT DEFAULT 'v4';
ALTER TABLE public.signal_audit_log ADD COLUMN IF NOT EXISTS strategy_version TEXT DEFAULT 'v4';

-- Payments system
CREATE TABLE IF NOT EXISTS public.payments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid references public.profiles(id) on delete cascade,
    email text NOT NULL,
    network text NOT NULL,
    txid text NOT NULL,
    amount text,
    plan text,
    status text DEFAULT 'PENDING',
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Referral system
CREATE TABLE IF NOT EXISTS public.referral_balances (
    email text PRIMARY KEY,
    balance double precision DEFAULT 0,
    paid_referrals integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.payout_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL,
    amount double precision NOT NULL,
    status text DEFAULT 'PENDING',
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Support Tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'UNREAD',
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Admin Audit Log
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    action text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid references auth.users on delete cascade,
    title text NOT NULL,
    message text NOT NULL,
    type text NOT NULL,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid references auth.users on delete cascade not null primary key,
    full_name text,
    avatar_url text,
    plan text DEFAULT 'FREE',
    is_admin boolean DEFAULT false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Add column for existing setups
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- Explicitly mark existing admin account if present (requires jumping through auth.users check if possible, or we just trust the app to have the trigger handle it)
-- Since auth.users is often protected in the user space, we can update profiles if email was stored, or we just leave the default trigger.
-- Actually we can't reliably join auth.users without doing it via a secure function or if we are the supabase superuser.
-- I'll create a function to bootstrap admin if needed.

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Notifications RLS policies
CREATE POLICY "Users can view their own notifications." ON public.notifications
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications." ON public.notifications
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notifications." ON public.notifications
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Profiles RLS policies
CREATE POLICY "Users can view their own profile." ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile." ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- Trigger to create profile and log audit on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, is_admin)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url', new.email = 'tofamo1818@gmail.com');

  INSERT INTO public.admin_audit_logs (user_id, action, details)
  VALUES (new.id, 'USER_REGISTRATION', jsonb_build_object('email', new.email));

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger execution for new users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to log admin audit and create notifications on signal generation
CREATE OR REPLACE FUNCTION public.handle_new_signal()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.admin_audit_logs (action, details)
  VALUES ('SIGNAL_GENERATED', jsonb_build_object('pair', new.pair, 'direction', new.direction, 'tier', new.tier));
  
  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT id, 'New ' || new.tier || ' Signal', 'Signal generated for ' || new.pair || ' (' || new.direction || ')', 'SIGNAL'
  FROM public.profiles;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_signal_generated ON public.signals;
CREATE TRIGGER on_signal_generated
  AFTER INSERT ON public.signals
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_signal();

-- Trigger for Payment updates and Subscription updates
CREATE OR REPLACE FUNCTION public.handle_payment_update()
RETURNS trigger AS $$
BEGIN
  IF new.status = 'APPROVED' AND old.status != 'APPROVED' THEN
    IF new.user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (new.user_id, 'Payment Approved', 'Your payment (' || new.txid || ') has been approved. Subscription activated!', 'PAYMENT');
      
      UPDATE public.profiles
      SET plan = 'ELITE'
      WHERE id = new.user_id;
    END IF;
  ELSIF new.status = 'REJECTED' AND old.status != 'REJECTED' THEN
    IF new.user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (new.user_id, 'Payment Rejected', 'Your payment (' || new.txid || ') could not be verified. Please contact support.', 'PAYMENT');
    END IF;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_payment_update ON public.payments;
CREATE TRIGGER on_payment_update
  AFTER UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_payment_update();

-- Trigger for Referral updates
CREATE OR REPLACE FUNCTION public.handle_referral_update()
RETURNS trigger AS $$
BEGIN
  IF new.paid_referrals > old.paid_referrals THEN
    INSERT INTO public.notifications (user_id, title, message, type)
    SELECT id, 'Referral Registered', 'A new user has registered using your referral link!', 'REFERRAL'
    FROM auth.users WHERE email = new.email;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_referral_update ON public.referral_balances;
CREATE TRIGGER on_referral_update
  AFTER UPDATE ON public.referral_balances
  FOR EACH ROW EXECUTE FUNCTION public.handle_referral_update();
CREATE OR REPLACE FUNCTION public.handle_new_ticket()
RETURNS trigger AS $$
BEGIN
  -- Notify the admins maybe? We will just insert for user if user_id is available. 
  -- But wait, support_tickets just has email. For this we will leave it or find the user matching email.
  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT id, 'Ticket Created', 'Your support ticket "' || new.subject || '" has been received.', 'TICKET'
  FROM auth.users WHERE email = new.email;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_ticket_created ON public.support_tickets;
CREATE TRIGGER on_ticket_created
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_ticket();

CREATE OR REPLACE FUNCTION public.handle_ticket_update()
RETURNS trigger AS $$
BEGIN
  IF new.status != old.status THEN
    INSERT INTO public.notifications (user_id, title, message, type)
    SELECT id, 'Ticket Update', 'Your support ticket "' || new.subject || '" is now ' || new.status || '.', 'TICKET'
    FROM auth.users WHERE email = new.email;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_ticket_updated ON public.support_tickets;
CREATE TRIGGER on_ticket_updated
  AFTER UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.handle_ticket_update();

-- ==============================================================================
-- ADMIN ACCESS CONTROL (Row Level Security)
-- ==============================================================================
-- Ensures ONLY admins can SELECT/UPDATE all records.
-- Regular users can only interact with their own data using auth.uid() or email check.

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_balances ENABLE ROW LEVEL SECURITY;

-- 1. Payments Policy
DROP POLICY IF EXISTS "Users view own payments" ON public.payments;
DROP POLICY IF EXISTS "Users insert own payments" ON public.payments;
DROP POLICY IF EXISTS "Admin full access payments" ON public.payments;

CREATE POLICY "Users view own payments" ON public.payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own payments" ON public.payments FOR INSERT WITH CHECK (auth.uid() = user_id AND status = 'PENDING');
CREATE POLICY "Admin full access payments" ON public.payments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- 2. Audit Logs Policy
DROP POLICY IF EXISTS "Admin full access audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admin full access audit logs" ON public.admin_audit_logs FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- 3. Payout Requests Policy
DROP POLICY IF EXISTS "Users view own payout requests" ON public.payout_requests;
DROP POLICY IF EXISTS "Users insert own payout requests" ON public.payout_requests;
DROP POLICY IF EXISTS "Admin full access payout requests" ON public.payout_requests;

CREATE POLICY "Users view own payout requests" ON public.payout_requests FOR SELECT USING (auth.jwt() ->> 'email' = email);
CREATE POLICY "Users insert own payout requests" ON public.payout_requests FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = email);
CREATE POLICY "Admin full access payout requests" ON public.payout_requests FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- 4. Referral Balances Policy
DROP POLICY IF EXISTS "Users view own referrals" ON public.referral_balances;
DROP POLICY IF EXISTS "Admin full access referrals" ON public.referral_balances;

CREATE POLICY "Users view own referrals" ON public.referral_balances FOR SELECT USING (auth.jwt() ->> 'email' = email);
CREATE POLICY "Admin full access referrals" ON public.referral_balances FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

