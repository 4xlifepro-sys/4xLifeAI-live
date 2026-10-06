-- 4xLifeAI — Copilot Signal page migration
-- Adds the columns needed by the /admin/copilot-signal page (paste → extract → review → publish).
-- Additive only: safe to re-run (IF NOT EXISTS everywhere). No data is changed or deleted.
-- Run this in the Supabase SQL editor of the 4xLifeAI application database.

-- Existing signal columns reused by the Copilot Signal page (kept here so one script covers everything):
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS timeframe text;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS strategy text;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS entry_price double precision;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS analysis_reason text;

-- New columns specific to Copilot-published signals:
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS signal_type text;            -- BUY / SELL / BUY STOP / SELL STOP
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS trigger_price double precision; -- pending trigger price, if provided
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS trend text;                  -- Bullish / Bearish / Range / Neutral
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS original_copilot_text text;  -- full original Copilot paste for audit
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS confidence integer;
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- status values used by this feature (text column, no enum change needed):
--   WAITING_TRIGGER : pending BUY STOP / SELL STOP, not yet tracked by the scanner
--   LIVE            : active signal, tracked by the scanner
-- Existing statuses (TP1_HIT, TP2_HIT, TP3_HIT, STOP_LOSS_HIT, CLOSED) are unchanged.

-- Index for faster admin history queries:
CREATE INDEX IF NOT EXISTS signals_created_at_idx ON public.signals (created_at DESC);
