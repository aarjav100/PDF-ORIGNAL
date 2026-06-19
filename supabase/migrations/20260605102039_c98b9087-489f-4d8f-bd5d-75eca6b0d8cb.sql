
CREATE TABLE public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY folders_all_own ON public.folders FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.documents
  ADD COLUMN folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  ADD COLUMN is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN last_opened_at timestamptz;

CREATE INDEX documents_user_folder_idx ON public.documents(user_id, folder_id);
CREATE INDEX documents_user_deleted_idx ON public.documents(user_id, deleted_at);
