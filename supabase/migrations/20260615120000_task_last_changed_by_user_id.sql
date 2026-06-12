-- Who last edited a task (for email changed_by_name via DB webhook).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS last_changed_by_user_id uuid;

COMMENT ON COLUMN public.tasks.last_changed_by_user_id IS
  'Auth user who last updated the row; set by trigger from JWT or explicit PATCH.';

CREATE OR REPLACE FUNCTION public.tasks_set_last_changed_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.last_changed_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_set_last_changed_by_trigger ON public.tasks;

CREATE TRIGGER tasks_set_last_changed_by_trigger
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_set_last_changed_by();
