ALTER TABLE public.task_change_log RENAME TO task_change_logs;

ALTER INDEX IF EXISTS task_change_log_task_id_idx RENAME TO task_change_logs_task_id_idx;
ALTER INDEX IF EXISTS task_change_log_request_id_idx RENAME TO task_change_logs_request_id_idx;
ALTER INDEX IF EXISTS task_change_log_email_provider_message_id_idx RENAME TO task_change_logs_email_provider_message_id_idx;
ALTER INDEX IF EXISTS task_change_log_email_status_idx RENAME TO task_change_logs_email_status_idx;
ALTER INDEX IF EXISTS task_change_log_unviewed_idx RENAME TO task_change_logs_unviewed_idx;

ALTER TABLE public.task_change_logs
  RENAME CONSTRAINT task_change_log_email_status_check TO task_change_logs_email_status_check;

ALTER TABLE public.task_change_logs
  RENAME CONSTRAINT task_change_log_email_template_key_check TO task_change_logs_email_template_key_check;

COMMENT ON TABLE public.task_change_logs IS 'Task change history: all field updates, email delivery state, and view tracking.';
