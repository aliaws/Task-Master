ALTER TABLE public.task_change_logs DROP CONSTRAINT IF EXISTS task_change_logs_email_template_key_check;

ALTER TABLE public.task_change_logs ADD CONSTRAINT task_change_logs_email_template_key_check
  CHECK (
    email_template_key IS NULL
    OR email_template_key IN (
      'priority_changed',
      'assigned_to_changed',
      'due_date_changed',
      'status_changed',
      'mention'
    )
  );
