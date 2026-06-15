-- Kanban display order within a column (tasks.status_id).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS task_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tasks.task_order IS
  'Display order within a kanban column (status_id). Lower values appear first.';

-- Backfill existing rows by created_at within each status_id column.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY status_id
      ORDER BY created_at ASC, id ASC
    ) - 1 AS rn
  FROM public.tasks
)
UPDATE public.tasks t
SET task_order = ranked.rn
FROM ranked
WHERE t.id = ranked.id;

CREATE INDEX IF NOT EXISTS tasks_status_id_task_order_idx
  ON public.tasks (status_id, task_order);
