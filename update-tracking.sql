ALTER TABLE public.signal_audit_log
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS current_status text DEFAULT 'OPEN',
ADD COLUMN IF NOT EXISTS tp1_hit boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS tp2_hit boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS tp3_hit boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS tp1_hit_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS tp2_hit_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS tp3_hit_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone;

-- For existing VALID ones, make them active
UPDATE public.signal_audit_log SET is_active = true, current_status = 'OPEN' WHERE status = 'VALID' AND is_active = false;
