-- Required Migrations for Scanner Integrity

-- 1. scanner_stats
CREATE TABLE IF NOT EXISTS public.scanner_stats (
    id integer PRIMARY KEY DEFAULT 1,
    "scanCycles" integer DEFAULT 0,
    "lastScanDuration" integer DEFAULT 0,
    "lastScanTime" bigint,
    "totalAssetsConfigured" integer DEFAULT 0,
    "activeAssets" integer DEFAULT 0,
    "totalScannedAssets" integer DEFAULT 0,
    "telegramPushes" integer DEFAULT 0,
    "duplicateEvents" integer DEFAULT 0,
    "rateLimitRecoveries" integer DEFAULT 0,
    "lastSignalTimestamp" bigint,
    "lastTradeTimestamp" bigint,
    "scannerStartTime" bigint,
    "totalScanDurationMs" bigint DEFAULT 0,
    "isDegraded" boolean DEFAULT false,
    "consecutiveApiErrors" integer DEFAULT 0,
    "mode" text DEFAULT 'forex',
    "created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()),
    "updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 2. active_opportunities
CREATE TABLE IF NOT EXISTS public.active_opportunities (
    id uuid PRIMARY KEY,
    pair text NOT NULL,
    direction text NOT NULL,
    entry double precision NOT NULL,
    sl double precision NOT NULL,
    tp1 double precision,
    tp2 double precision,
    tp3 double precision,
    confidence integer,
    status text,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 3. trades
CREATE TABLE IF NOT EXISTS public.trades (
    id uuid PRIMARY KEY,
    pair text NOT NULL,
    direction text NOT NULL,
    entry double precision NOT NULL,
    sl double precision NOT NULL,
    original_sl double precision,
    tp1 double precision,
    tp2 double precision,
    tp3 double precision,
    confidence integer,
    grade text,
    status text,
    opened_at timestamp with time zone,
    closed_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 4. signals.original_sl
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS original_sl double precision;

-- 5. signal_audit_log.final_score
ALTER TABLE public.signal_audit_log ADD COLUMN IF NOT EXISTS final_score double precision;

-- 6. Admin Signal Builder metadata on published signals
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS strategy text;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS ocl text;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS entry_type text DEFAULT 'IMMEDIATE';
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS tp4 double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS tp5 double precision;

-- 7. Admin Signal Builder drafts
CREATE TABLE IF NOT EXISTS public.signal_drafts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_email text NOT NULL,
    pair text NOT NULL,
    strategy text,
    direction text,
    ocl text,
    entry double precision,
    sl double precision,
    tp_multiples jsonb DEFAULT '[]'::jsonb,
    confidence integer,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);
