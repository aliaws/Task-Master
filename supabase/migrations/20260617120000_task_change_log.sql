-- Rename email_notifications → task_change_log; extend for full task activity + view tracking.

ALTER TABLE public.email_notifications RENAME TO task_change_log;

ALTER TABLE public.task_change_log RENAME COLUMN template_key TO email_template_key;
ALTER TABLE public.task_change_log RENAME COLUMN subject TO email_subject;
ALTER TABLE public.task_change_log RENAME COLUMN status TO email_status;
ALTER TABLE public.task_change_log RENAME COLUMN provider_message_id TO email_provider_message_id;
ALTER TABLE public.task_change_log RENAME COLUMN error_message TO email_error_message;
ALTER TABLE public.task_change_log RENAME COLUMN sent_at TO email_sent_at;

ALTER TABLE public.task_change_log
  ADD COLUMN IF NOT EXISTS old_value jsonb,
  ADD COLUMN IF NOT EXISTS new_value jsonb,
  ADD COLUMN IF NOT EXISTS is_viewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz;

ALTER TABLE public.task_change_log
  ALTER COLUMN email_template_key DROP NOT NULL,
  ALTER COLUMN recipient_email DROP NOT NULL,
  ALTER COLUMN email_subject DROP NOT NULL,
  ALTER COLUMN email_status SET DEFAULT 'not_applicable';

ALTER TABLE public.task_change_log
  DROP CONSTRAINT IF EXISTS email_notifications_status_check,
  DROP CONSTRAINT IF EXISTS email_notifications_template_key_check;

ALTER TABLE public.task_change_log
  ADD CONSTRAINT task_change_log_email_status_check
    CHECK (email_status IN (
      'not_applicable',
      'pending',
      'sent',
      'delivered',
      'opened',
      'bounced',
      'failed',
      'skipped'
    )),
  ADD CONSTRAINT task_change_log_email_template_key_check
    CHECK (
      email_template_key IS NULL
      OR email_template_key IN (
        'priority_changed',
        'assigned_to_changed',
        'due_date_changed',
        'status_changed'
      )
    );

ALTER INDEX IF EXISTS email_notifications_task_id_idx
  RENAME TO task_change_log_task_id_idx;
ALTER INDEX IF EXISTS email_notifications_request_id_idx
  RENAME TO task_change_log_request_id_idx;
ALTER INDEX IF EXISTS email_notifications_provider_message_id_idx
  RENAME TO task_change_log_email_provider_message_id_idx;
ALTER INDEX IF EXISTS email_notifications_status_idx
  RENAME TO task_change_log_email_status_idx;

CREATE INDEX IF NOT EXISTS task_change_log_unviewed_idx
  ON public.task_change_log (task_id, created_at DESC)
  WHERE NOT is_viewed;

COMMENT ON TABLE public.task_change_log IS
  'Task change history: all field updates, email delivery state, and view tracking.';
