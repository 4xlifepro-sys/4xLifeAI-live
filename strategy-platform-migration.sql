CREATE TABLE IF NOT EXISTS public.strategy_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_preset_id uuid,
  strategy_version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.strategy_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  config jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.strategy_conditions (
  id text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('REQUIRED', 'OPTIONAL', 'DISABLED')),
  weight numeric NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 100),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.strategy_poi_settings (
  poi_type text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  mode text NOT NULL DEFAULT 'OPTIONAL' CHECK (mode IN ('REQUIRED', 'OPTIONAL', 'DISABLED')),
  weight numeric NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 100),
  priority integer NOT NULL DEFAULT 0,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.risk_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_risk_percent numeric NOT NULL DEFAULT 1 CHECK (default_risk_percent > 0 AND default_risk_percent <= 2),
  maximum_risk_percent numeric NOT NULL DEFAULT 2 CHECK (maximum_risk_percent > 0 AND maximum_risk_percent <= 2),
  minimum_reward_risk numeric NOT NULL DEFAULT 1 CHECK (minimum_reward_risk > 0),
  sl_buffer_atr numeric NOT NULL DEFAULT 0.15 CHECK (sl_buffer_atr >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  state text NOT NULL CHECK (state IN ('WAITING', 'NO TRADE', 'BUY', 'SELL')),
  strategy_version integer NOT NULL,
  analysis jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signal_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id text NOT NULL,
  condition_key text NOT NULL,
  confirmed boolean,
  mode text NOT NULL CHECK (mode IN ('REQUIRED', 'OPTIONAL', 'DISABLED')),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trade_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id text,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  entry numeric,
  stop_loss numeric,
  take_profit jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome text NOT NULL DEFAULT 'OPEN' CHECK (outcome IN ('OPEN', 'WIN', 'LOSS', 'BREAKEVEN', 'CANCELLED')),
  risk_percent numeric,
  realized_r numeric,
  strategy_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  candle_time timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, timeframe, candle_time, source)
);

CREATE TABLE IF NOT EXISTS public.screenshot_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text,
  analysis jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.live_price_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  screenshot_price numeric,
  live_price numeric,
  difference numeric,
  status text NOT NULL CHECK (status IN ('LIVE PRICE VALIDATES', 'PRICE MISMATCH', 'NO LIVE DATA')),
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.strategy_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  strategy_version integer NOT NULL,
  test_config jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.strategy_analysis_logs (
  symbol text PRIMARY KEY,
  strategy_version integer NOT NULL,
  analysis jsonb NOT NULL,
  analyzed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_analysis_owner_created_idx ON public.market_analysis(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trade_history_owner_created_idx ON public.trade_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS screenshot_analysis_owner_created_idx ON public.screenshot_analysis(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategy_test_results_owner_created_idx ON public.strategy_test_results(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_data_symbol_tf_time_idx ON public.market_data(symbol, timeframe, candle_time DESC);

ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS entry_price double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS strategy_version text DEFAULT 'v1';
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS main_poi text;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS main_poi_price double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS analysis_reason text;
ALTER TABLE public.signals ALTER COLUMN tp2 DROP NOT NULL;
ALTER TABLE public.signals ALTER COLUMN tp3 DROP NOT NULL;
UPDATE public.signals SET entry_price = entry WHERE entry_price IS NULL AND entry IS NOT NULL;

ALTER TABLE public.strategy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_poi_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screenshot_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_price_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_analysis_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.strategy_settings, public.strategy_presets, public.strategy_conditions, public.strategy_poi_settings, public.risk_settings, public.market_data, public.system_settings, public.strategy_analysis_logs, public.signal_conditions FROM anon, authenticated;
GRANT ALL ON public.strategy_settings, public.strategy_presets, public.strategy_conditions, public.strategy_poi_settings, public.risk_settings, public.market_data, public.system_settings, public.strategy_analysis_logs, public.signal_conditions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_analysis, public.trade_history, public.user_preferences, public.screenshot_analysis, public.live_price_validation, public.strategy_test_results TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_analysis' AND policyname = 'market_analysis_owner_access') THEN
    CREATE POLICY market_analysis_owner_access ON public.market_analysis FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trade_history' AND policyname = 'trade_history_owner_access') THEN
    CREATE POLICY trade_history_owner_access ON public.trade_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_preferences' AND policyname = 'user_preferences_owner_access') THEN
    CREATE POLICY user_preferences_owner_access ON public.user_preferences FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'screenshot_analysis' AND policyname = 'screenshot_analysis_owner_access') THEN
    CREATE POLICY screenshot_analysis_owner_access ON public.screenshot_analysis FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'live_price_validation' AND policyname = 'live_price_validation_owner_access') THEN
    CREATE POLICY live_price_validation_owner_access ON public.live_price_validation FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'strategy_test_results' AND policyname = 'strategy_test_results_owner_access') THEN
    CREATE POLICY strategy_test_results_owner_access ON public.strategy_test_results FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

INSERT INTO public.strategy_settings (id, config, active, strategy_version)
VALUES (1, '{"name":"FULL ICT + SMC + MSNR","active":false,"version":1}', false, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.risk_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
