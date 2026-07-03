import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const sql = `
    CREATE TABLE IF NOT EXISTS public.plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      price TEXT NOT NULL,
      billing_period TEXT,
      original_price TEXT,
      features JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_popular BOOLEAN DEFAULT false,
      scan_limit INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Enable RLS
    ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

    -- Create policies
    CREATE POLICY "Allow public read access" ON public.plans
      FOR SELECT USING (true);
      
    CREATE POLICY "Allow admin write access" ON public.plans
      FOR ALL USING (auth.jwt() ->> 'email' = '4xlifepro@gmail.com');

    -- Insert seed data if table is empty
    INSERT INTO public.plans (name, price, billing_period, original_price, features, is_popular, scan_limit)
    SELECT 'Free', '$0', '/forever', NULL, 
      '["5 scans per day", "Standard Forex Major pairs support", "Public Traders Desk access"]'::jsonb, 
      false, 5
    WHERE NOT EXISTS (SELECT 1 FROM public.plans WHERE name = 'Free');

    INSERT INTO public.plans (name, price, billing_period, original_price, features, is_popular, scan_limit)
    SELECT 'Premium', '$25', '/per month', '$39', 
      '["Unlimited scans", "Telegram alerts", "AI Coach", "Institutional execution templates", "Priority Support"]'::jsonb, 
      true, NULL
    WHERE NOT EXISTS (SELECT 1 FROM public.plans WHERE name = 'Premium');
  `;
  
  const { error } = await supabaseAdmin.rpc('exec_sql', { query: sql });
  if (error) {
    console.log("Could not execute raw SQL (maybe RPC is missing), trying direct insert...");
    
    // We can't easily create tables without RPC. We'll just create the table in Supabase's SQL editor?
    console.error(error);
  } else {
    console.log("Migration successful");
  }
}

run().catch(console.error);
