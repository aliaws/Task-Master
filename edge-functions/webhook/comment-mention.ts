import { sql } from "./email-db.ts";
import { sendSmtpEmail } from "./email-smtp.ts";

const MENTION_RE = /\[([^\]]+)\]/g;

function displayNameFromAuthUser(user: { raw_user_meta_data?: Record<string, unknown> | null; email?: string | null }): string {
  const meta = user?.raw_user_meta_data ?? {};
  const first = String(meta.first_name ?? "").trim();
  const last = String(meta.last_name ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) return full;
  const email = user?.email ?? "";
  return email.includes("@") ? email.split("@")[0] : email || "Someone";
}

async function resolveMentionedUser(mentionName: string) {
  const name = mentionName.trim();
  if (!name) return null;

  type UserRow = { id: string; email: string; raw_user_meta_data: Record<string, unknown> | null };
  const rows = await sql<UserRow[]>`
    SELECT id, email, raw_user_meta_data
    FROM auth.users
    WHERE TRIM(CONCAT_WS(' ', raw_user_meta_data->>'first_name', raw_user_meta_data->>'last_name')) ILIKE ${name}
       OR split_part(email, '@', 1) ILIKE ${name}
    LIMIT 1
  `;
  if (!rows.length) return null;
  return {
    id: rows[0].id,
    email: rows[0].email,
    display_name: displayNameFromAuthUser(rows[0]),
  };
}

function renderTemplate(template: string, vars: Record<string, unknown>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return out;
}

async function loadEmailTemplate(templateKey: string) {
  type TemplateRow = { subject_template: string; body_html_template: string };
  const rows = await sql<TemplateRow[]>`
    SELECT subject_template, body_html_template
    FROM public.email_templates
    WHERE template_key = ${templateKey} AND is_active = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function appBaseUrl(): string {
  return (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
}

function taskUrl(taskId: number, logId: number, commentId: number | null): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  const url = new URL("/", `${base}/`);
  url.searchParams.set("task", String(taskId));
  url.searchParams.set("from", "kanban");
  url.searchParams.set("notification_id", String(logId));
  if (commentId != null) {
    url.searchParams.set("comment_id", String(commentId));
  }
  return url.href;
}

export async function handleCommentInsert(record: Record<string, unknown>) {
  const content = String(record.content ?? "");
  const taskId = Number(record.task_id);
  const commentId = Number(record.id);
  const userId = record.user_id ? String(record.user_id) : null;

  if (!taskId || !commentId || !userId) {
    return { skipped: true, reason: "missing required fields" };
  }

  const authorRows = await sql<{ email: string; raw_user_meta_data: Record<string, unknown> | null }[]>`
    SELECT email, raw_user_meta_data
    FROM auth.users
    WHERE id = ${userId}
    LIMIT 1
  `;

  let authorName = "Someone";
  if (authorRows.length) {
    authorName = displayNameFromAuthUser(authorRows[0]);
  }

  const mentions: { name: string }[] = [];
  let match: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(content)) !== null) {
    const name = match[1];
    if (!mentions.some((m) => m.name === name)) {
      mentions.push({ name });
    }
  }

  if (!mentions.length) {
    return { skipped: true, reason: "no mentions found" };
  }

  let mentionCount = 0;
  let emailedCount = 0;
  const seen = new Set<string>();

  for (const { name } of mentions) {
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    const user = await resolveMentionedUser(name);
    if (!user) {
      await sql`
        INSERT INTO public.task_change_logs (
          request_id, task_id, field_name,
          old_display_value, new_display_value,
          old_value, new_value,
          changed_by_user_id, changed_by_name,
          email_template_key, recipient_email,
          email_subject, email_status, email_error_message
        ) VALUES (
          ${crypto.randomUUID()}, ${taskId}, 'mention',
          NULL, 'mentioned user not found',
          NULL, ${sql.json({ mention_name: name, comment_id: commentId })},
          ${userId}, ${authorName},
          NULL, NULL,
          NULL, 'skipped', 'mentioned user not found'
        )
      `;
      mentionCount++;
      continue;
    }
    if (user.id === userId) continue;

    mentionCount++;
    const snippet = content.length > 200 ? content.slice(0, 197) + "..." : content;
    const requestId = crypto.randomUUID();

    const logRows = await sql<{ id: number }[]>`
      INSERT INTO public.task_change_logs (
        request_id, task_id, field_name,
        old_display_value, new_display_value,
        old_value, new_value,
        changed_by_user_id, changed_by_name,
        email_template_key, recipient_email,
        email_subject, email_status
      ) VALUES (
        ${requestId}, ${taskId}, 'mention',
        NULL, 'mentioned you in a comment',
        NULL, ${sql.json({ comment_id: commentId, snippet })},
        ${userId}, ${authorName},
        'mention', ${user.email},
        NULL, 'pending'
      )
      RETURNING id
    `;

    const logId = logRows[0]?.id;
    if (!logId) continue;

    const template = await loadEmailTemplate("mention");
    if (!template) {
      await sql`
        UPDATE public.task_change_logs
        SET email_status = 'skipped', email_error_message = 'template not found'
        WHERE id = ${logId}
      `;
      continue;
    }

    const changedAt = new Date().toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: "UTC",
    });

    const taskRow = await sql<{ title: string | null }[]>`
      SELECT title FROM public.tasks WHERE id = ${taskId} LIMIT 1
    `;
    const taskTitle = taskRow[0]?.title ?? `Task #${taskId}`;

    const headline = `${authorName} mentioned you in a comment`;
    const baseVars = {
      comment_author: authorName,
      headline,
      task_title: taskTitle,
      comment_snippet: snippet,
      changed_at: changedAt,
    };

    const emailSubject = renderTemplate(template.subject_template, baseVars);
    const taskUrlStr = taskUrl(taskId, logId, commentId);
    const html = renderTemplate(template.body_html_template, {
      ...baseVars,
      task_url: taskUrlStr ?? "",
    });

    await sql`
      UPDATE public.task_change_logs
      SET email_subject = ${emailSubject}
      WHERE id = ${logId}
    `;

    try {
      const messageId = await sendSmtpEmail({
        to: user.email,
        subject: emailSubject,
        html,
      });
      await sql`
        UPDATE public.task_change_logs
        SET email_status = 'sent', email_provider_message_id = ${messageId ?? null}, email_sent_at = now()
        WHERE id = ${logId}
      `;
      emailedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sql`
        UPDATE public.task_change_logs
        SET email_status = 'failed', email_error_message = ${msg}
        WHERE id = ${logId}
      `;
    }
  }

  return { mentions_found: mentionCount, emailed: emailedCount };
}

export async function handleCommentDelete(record: Record<string, unknown>) {
  const commentId = Number(record.id);
  if (!commentId) {
    return { skipped: true, reason: "missing comment id" };
  }
  return { deleted: true, comment_id: commentId };
}
