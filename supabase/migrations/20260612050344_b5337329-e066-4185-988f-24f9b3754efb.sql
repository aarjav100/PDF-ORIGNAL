
CREATE TABLE public.datasets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  cleaned_storage_path TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  row_count INTEGER,
  column_count INTEGER,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  analysis JSONB,
  pipeline JSONB,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.datasets TO authenticated;
GRANT ALL ON public.datasets TO service_role;

ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

CREATE POLICY datasets_all_own ON public.datasets
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_datasets_updated_at BEFORE UPDATE ON public.datasets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage policies for the `datasets` bucket: files keyed by `<user_id>/...`
INSERT INTO storage.buckets (id, name, public) VALUES ('datasets', 'datasets', false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "datasets_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'datasets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "datasets_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'datasets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "datasets_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'datasets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "datasets_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'datasets' AND auth.uid()::text = (storage.foldername(name))[1]);
