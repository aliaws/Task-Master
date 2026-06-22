-- Add 'mention' to the email_templates CHECK constraint and insert the template.
-- The mention email is sent when a user is @mentioned in a task comment.

ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_template_key_check;

ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_template_key_check
  CHECK (template_key IN (
    'priority_changed',
    'assigned_to_changed',
    'due_date_changed',
    'status_changed',
    'mention'
  ));

INSERT INTO public.email_templates (template_key, subject_template, body_html_template)
VALUES (
  'mention',
  '{{comment_author}} mentioned you in {{task_title}}',
  $tmpl$<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;"><tr><td style="padding:24px 32px 8px;font-size:13px;color:#6d6e6f;">Task Master</td></tr><tr><td style="padding:28px 32px 12px;font-size:24px;font-weight:700;color:#1e1f21;line-height:1.3;">{{task_title}}</td></tr><tr><td style="padding:0 32px 8px;font-size:16px;color:#1e1f21;">{{headline}}</td></tr><tr><td style="padding:0 32px 24px;"><table width="100%" style="border:1px solid #e8ecee;border-radius:8px;background:#fafbfc;"><tr><td style="padding:16px;"><div style="font-size:13px;color:#6d6e6f;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">Comment</div><div style="font-size:15px;color:#1e1f21;">{{comment_snippet}}</div></td></tr></table></td></tr><tr><td style="padding:0 32px 16px;font-size:14px;color:#6d6e6f;">By <strong style="color:#1e1f21;">{{comment_author}}</strong> on {{changed_at}}</td></tr><tr><td style="padding:0 32px 32px;"><a href="{{task_url}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">View Task</a></td></tr></table></td></tr></table></body></html>$tmpl$
)
ON CONFLICT (template_key) DO NOTHING;
