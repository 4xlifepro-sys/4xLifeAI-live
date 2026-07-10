-- Track how many signals each user views per day
CREATE TABLE IF NOT EXISTS public.user_signal_views (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  view_date date NOT NULL DEFAULT CURRENT_DATE,
  signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  UNIQUE(user_id, view_date, signal_id)
);

ALTER TABLE public.user_signal_views ENABLE ROW LEVEL SECURITY;

-- Users can only see their own rows
CREATE POLICY "Users view own signal views" ON public.user_signal_views
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own signal views" ON public.user_signal_views
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admin full access signal views" ON public.user_signal_views
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');
