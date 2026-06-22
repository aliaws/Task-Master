-- Task update email templates + delivery audit (lean schema).

CREATE TABLE IF NOT EXISTS public.email_templates (
  template_key text PRIMARY KEY
    CHECK (template_key IN (
      'priority_changed',
      'assigned_to_changed',
      'due_date_changed',
      'status_changed'
    )),
  subject_template text NOT NULL,
  body_html_template text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.email_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),

  task_id integer NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  template_key text NOT NULL
    CHECK (template_key IN (
      'priority_changed',
      'assigned_to_changed',
      'due_date_changed',
      'status_changed'
    )),
  field_name text NOT NULL,

  old_display_value text,
  new_display_value text,

  changed_by_user_id uuid,
  changed_by_name text,

  recipient_email text NOT NULL,
  subject text NOT NULL,

  provider_message_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'sent',
      'delivered',
      'opened',
      'bounced',
      'failed',
      'skipped'
    )),
  error_message text,

  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_notifications_task_id_idx
  ON public.email_notifications (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_notifications_request_id_idx
  ON public.email_notifications (request_id);

CREATE INDEX IF NOT EXISTS email_notifications_provider_message_id_idx
  ON public.email_notifications (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_notifications_status_idx
  ON public.email_notifications (status, created_at DESC);

COMMENT ON TABLE public.email_templates IS
  'Customizable Asana-style HTML templates for task field change emails.';
COMMENT ON TABLE public.email_notifications IS
  'Audit log for task update notification emails and delivery status.';

-- Shared Asana-style layout (placeholders: actor_name, headline, task_title, field_label, old_value, new_value, changed_at, task_url)
INSERT INTO public.email_templates (template_key, subject_template, body_html_template)
VALUES
  (
    'priority_changed',
    'Priority updated on {{task_title}}',
    $tmpl$<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;"><tr><td style="padding:24px 32px 8px;font-size:13px;color:#6d6e6f;">Task Master</td></tr><tr><td style="padding:8px 32px 16px;font-size:20px;font-weight:600;color:#1e1f21;">{{headline}}</td></tr><tr><td style="padding:0 32px 24px;"><table width="100%" style="border:1px solid #e8ecee;border-radius:8px;background:#fafbfc;"><tr><td style="padding:16px;"><div style="font-size:16px;font-weight:600;color:#1e1f21;margin-bottom:8px;">{{task_title}}</div><div style="font-size:14px;color:#6d6e6f;">{{field_label}}: <strong>{{old_value}}</strong> → <strong>{{new_value}}</strong></div><div style="font-size:13px;color:#9ca0a4;margin-top:12px;">Changed by {{actor_name}} on {{changed_at}}</div></td></tr></table></td></tr><tr><td style="padding:0 32px 32px;"><a href="{{task_url}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">View task</a></td></tr></table></td></tr></table></body></html>$tmpl$
  ),
  (
    'assigned_to_changed',
    'You were assigned: {{task_title}}',
    $tmpl$<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;"><tr><td style="padding:24px 32px 8px;font-size:13px;color:#6d6e6f;">Task Master</td></tr><tr><td style="padding:8px 32px 16px;font-size:20px;font-weight:600;color:#1e1f21;">{{headline}}</td></tr><tr><td style="padding:0 32px 24px;"><table width="100%" style="border:1px solid #e8ecee;border-radius:8px;background:#fafbfc;"><tr><td style="padding:16px;"><div style="font-size:16px;font-weight:600;color:#1e1f21;margin-bottom:8px;">{{task_title}}</div><div style="font-size:14px;color:#6d6e6f;">{{field_label}}: <strong>{{old_value}}</strong> → <strong>{{new_value}}</strong></div><div style="font-size:13px;color:#9ca0a4;margin-top:12px;">Changed by {{actor_name}} on {{changed_at}}</div></td></tr></table></td></tr><tr><td style="padding:0 32px 32px;"><a href="{{task_url}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">View task</a></td></tr></table></td></tr></table></body></html>$tmpl$
  ),
  (
    'due_date_changed',
    'Due date updated on {{task_title}}',
    $tmpl$<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;"><tr><td style="padding:24px 32px 8px;font-size:13px;color:#6d6e6f;">Task Master</td></tr><tr><td style="padding:8px 32px 16px;font-size:20px;font-weight:600;color:#1e1f21;">{{headline}}</td></tr><tr><td style="padding:0 32px 24px;"><table width="100%" style="border:1px solid #e8ecee;border-radius:8px;background:#fafbfc;"><tr><td style="padding:16px;"><div style="font-size:16px;font-weight:600;color:#1e1f21;margin-bottom:8px;">{{task_title}}</div><div style="font-size:14px;color:#6d6e6f;">{{field_label}}: <strong>{{old_value}}</strong> → <strong>{{new_value}}</strong></div><div style="font-size:13px;color:#9ca0a4;margin-top:12px;">Changed by {{actor_name}} on {{changed_at}}</div></td></tr></table></td></tr><tr><td style="padding:0 32px 32px;"><a href="{{task_url}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">View task</a></td></tr></table></td></tr></table></body></html>$tmpl$
  ),
  (
    'status_changed',
    'Status updated on {{task_title}}',
    $tmpl$<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;"><tr><td style="padding:24px 32px 8px;font-size:13px;color:#6d6e6f;">Task Master</td></tr><tr><td style="padding:8px 32px 16px;font-size:20px;font-weight:600;color:#1e1f21;">{{headline}}</td></tr><tr><td style="padding:0 32px 24px;"><table width="100%" style="border:1px solid #e8ecee;border-radius:8px;background:#fafbfc;"><tr><td style="padding:16px;"><div style="font-size:16px;font-weight:600;color:#1e1f21;margin-bottom:8px;">{{task_title}}</div><div style="font-size:14px;color:#6d6e6f;">{{field_label}}: <strong>{{old_value}}</strong> → <strong>{{new_value}}</strong></div><div style="font-size:13px;color:#9ca0a4;margin-top:12px;">Changed by {{actor_name}} on {{changed_at}}</div></td></tr></table></td></tr><tr><td style="padding:0 32px 32px;"><a href="{{task_url}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">View task</a></td></tr></table></td></tr></table></body></html>$tmpl$
  )
ON CONFLICT (template_key) DO NOTHING;
