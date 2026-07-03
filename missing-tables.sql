-- Missing schema elements
CREATE TABLE IF NOT EXISTS public.referral_balances (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text UNIQUE NOT NULL,
    total_referrals integer DEFAULT 0,
    paid_referrals integer DEFAULT 0,
    available_balance double precision DEFAULT 0.0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.referral_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own referrals" ON public.referral_balances FOR SELECT USING (auth.jwt() ->> 'email' = email);
CREATE POLICY "Admin full access referrals" ON public.referral_balances FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

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
CREATE POLICY "Users view own payout requests" ON public.payout_requests FOR SELECT USING (auth.jwt() ->> 'email' = email);
CREATE POLICY "Users insert own payout requests" ON public.payout_requests FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = email);
CREATE POLICY "Admin full access payout requests" ON public.payout_requests FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);
