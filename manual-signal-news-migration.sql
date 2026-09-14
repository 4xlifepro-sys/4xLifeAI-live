ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS news_event text,
  ADD COLUMN IF NOT EXISTS news_impact varchar(10),
  ADD COLUMN IF NOT EXISTS news_time timestamptz;

NOTIFY pgrst, 'reload schema';