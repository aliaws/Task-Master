ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS parent_id integer
  REFERENCES public.task_comments (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS task_comments_parent_id_idx
  ON public.task_comments (parent_id);

COMMENT ON COLUMN public.task_comments.parent_id IS 'NULL = top-level comment; set = reply. No deep nesting (parent.parent_id must be NULL).';
