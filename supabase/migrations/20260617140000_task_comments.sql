-- Task comments for user discussions on tasks.

CREATE TABLE IF NOT EXISTS public.task_comments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id integer NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  user_id uuid,
  display_name text NOT NULL DEFAULT '',
  initials text,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_comments_task_id_idx
  ON public.task_comments (task_id, created_at ASC);

COMMENT ON TABLE public.task_comments IS 'User comments on tasks.';
