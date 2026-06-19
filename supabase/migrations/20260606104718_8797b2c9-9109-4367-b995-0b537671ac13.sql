-- Add Pro flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_pro boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pro_since timestamptz;

-- Ad analytics events
CREATE TABLE IF NOT EXISTS public.ad_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slot text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('impression','click','reward')),
  placement text,
  revenue_micros bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ad_events TO authenticated;
GRANT ALL ON public.ad_events TO service_role;
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ad_events_insert_own ON public.ad_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY ad_events_select_own ON public.ad_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS ad_events_user_created_idx ON public.ad_events (user_id, created_at DESC);