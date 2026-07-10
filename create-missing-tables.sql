-- Create missing tables for Admin dashboard
-- All admin policies use: auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
-- No hardcoded emails, no profiles table references

-- 1. Payout Requests
CREATE TABLE IF NOT EXISTS public.payout_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL,
    amount double precision NOT NULL,
    crypto_address text NOT NULL,
    status text DEFAULT 'PENDING',
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    processed_at timestamp with time zone,
    txid text
);

ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own payout requests" ON public.payout_requests 
    FOR SELECT USING (auth.jwt() ->> 'email' = email);

CREATE POLICY "Users insert own payout requests" ON public.payout_requests 
    FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = email);

CREATE POLICY "Admin full access payout requests" ON public.payout_requests 
    FOR ALL
    USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');

-- 2. Support Tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'UNREAD',
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own support tickets" ON public.support_tickets 
    FOR SELECT USING (auth.jwt() ->> 'email' = email);

CREATE POLICY "Users insert own support tickets" ON public.support_tickets 
    FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = email);

CREATE POLICY "Admin full access support tickets" ON public.support_tickets 
    FOR ALL
    USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');

-- 3. Admin Audit Logs
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    action text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access audit logs" ON public.admin_audit_logs 
    FOR ALL
    USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');

-- 4. Scanner Stats
CREATE TABLE IF NOT EXISTS public.scanner_stats (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    total_scans integer DEFAULT 0,
    successful_signals integer DEFAULT 0,
    rejected_signals integer DEFAULT 0,
    last_scan_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.scanner_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access scanner stats" ON public.scanner_stats 
    FOR ALL
    USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');

-- 5. Signal Results
CREATE TABLE IF NOT EXISTS public.signal_results (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    signal_id uuid,
    pair text NOT NULL,
    direction text NOT NULL,
    entry_price double precision NOT NULL,
    sl_price double precision NOT NULL,
    tp1_price double precision,
    tp2_price double precision,
    tp3_price double precision,
    status text DEFAULT 'ACTIVE',
    result text,
    pips_won double precision DEFAULT 0,
    pips_lost double precision DEFAULT 0,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.signal_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access signal results" ON public.signal_results 
    FOR ALL
    USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');

-- 6. Signals table (for Admin dashboard signals list)
CREATE TABLE IF NOT EXISTS public.signals (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    pair text NOT NULL,
    direction text NOT NULL,
    entry double precision NOT NULL,
    sl double precision NOT NULL,
    tp1 double precision NOT NULL,
    tp2 double precision NOT NULL,
    tp3 double precision NOT NULL,
    confidence integer,
    tier text,
    status text DEFAULT 'ACTIVE',
    timestamp timestamp with time zone DEFAULT timezone('utc'::text, now()),
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access signals" ON public.signals 
    FOR SELECT USING (true);

CREATE POLICY "Admin full access signals" ON public.signals 
    FOR ALL
    USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');
