import nodemailer from "npm:nodemailer@6.9.16";
import { sql } from "./db.js";
import { initialsFromDisplayName } from "./utils.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MENTION_RE = /\[([^\]]+)\]/g;

function displayNameFromAuthUser(user) {
  const meta = user?.raw_user_meta_data ?? {};
  const first = String(meta.first_name ?? "").trim();
  const last = String(meta.last_name ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) return full;
  const email = user?.email ?? "";
  return email.includes("@") ? email.split("@")[0] : email || "Someone";
}

function parsePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return n;
}

function optionalString(value) {
  if (value == null || value === "") return null;
  return String(value).trim();
}

function requiredString(value, label) {
  const s = optionalString(value);
  if (!s) throw new Error(`${label} is required`);
  return s;
}

async function resolveCommentUser(userId) {
  if (!userId) return { display_name: null, initials: null };

  const id = String(userId).trim();
  if (!UUID_RE.test(id)) return { display_name: null, initials: null };

  const rows = await sql`
    SELECT id, email, raw_user_meta_data
    FROM auth.users
    WHERE id = ${id}
    LIMIT 1
  `;

  if (!rows.length) return { display_name: null, initials: null };

  const name = displayNameFromAuthUser(rows[0]);
  return { display_name: name, initials: initialsFromDisplayName(name) };
}

async function resolveMentionedUser(mentionName) {
  const name = mentionName.trim();
  if (!name) return null;

  const rows = await sql`
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

function renderTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return out;
}

async function loadEmailTemplate(templateKey) {
  const rows = await sql`
    SELECT subject_template, body_html_template
    FROM public.email_templates
    WHERE template_key = ${templateKey} AND is_active = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function appBaseUrl() {
  return (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
}

function taskUrl(taskId, logId, commentId) {
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

function smtpConfig() {
  const host = Deno.env.get("SMTP_HOST")?.trim();
  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");
  const user = Deno.env.get("SMTP_USER")?.trim();
  const pass = Deno.env.get("SMTP_PASS");
  const fromEmail = Deno.env.get("MAIL_FROM")?.trim();
  const fromName = Deno.env.get("MAIL_FROM_NAME")?.trim() || "Task Master";

  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (!fromEmail) missing.push("MAIL_FROM");

  if (missing.length) return null;

  const secure =
    Deno.env.get("SMTP_SECURE") === "true"
      ? true
      : Deno.env.get("SMTP_SECURE") === "false"
        ? false
        : port === 465;

  const safeName = fromName.replace(/>+$/, "").trim();
  return { host, port, user, pass, fromName: safeName, fromEmail, secure };
}

async function sendMentionEmail(recipientEmail, subject, html) {
  const config = smtpConfig();
  if (!config) return { sent: false, reason: "SMTP not configured" };

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });

  try {
    const info = await transporter.sendMail({
      from: { name: config.fromName, address: config.fromEmail },
      to: recipientEmail,
      subject,
      html,
    });
    return { sent: true, messageId: info?.messageId ?? null };
  } finally {
    transporter.close();
  }
}

async function logMentions(taskId, commentId, content, authorUserId, authorName) {
  const mentions = [];
  let match;
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(content)) !== null) {
    const name = match[1];
    if (!mentions.some((m) => m.name === name)) {
      mentions.push({ name });
    }
  }

  if (!mentions.length) return;

  const seen = new Set();
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
          ${authorUserId}, ${authorName},
          NULL, NULL,
          NULL, 'skipped', 'mentioned user not found'
        )
      `;
      continue;
    }
    if (user.id === authorUserId) continue;

    const snippet =
      content.length > 200 ? content.slice(0, 197) + "..." : content;

    const requestId = crypto.randomUUID();

    const logRows = await sql`
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
        ${authorUserId}, ${authorName},
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

    const taskRow = await sql`
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
      const result = await sendMentionEmail(user.email, emailSubject, html);
      if (result.sent) {
        await sql`
          UPDATE public.task_change_logs
          SET email_status = 'sent', email_provider_message_id = ${result.messageId}, email_sent_at = now()
          WHERE id = ${logId}
        `;
      } else {
        await sql`
          UPDATE public.task_change_logs
          SET email_status = 'failed', email_error_message = ${result.reason}
          WHERE id = ${logId}
        `;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sql`
        UPDATE public.task_change_logs
        SET email_status = 'failed', email_error_message = ${msg}
        WHERE id = ${logId}
      `;
    }
  }
}

function mapComment(row) {
  return {
    id: row.id,
    content: row.content,
    user_id: row.user_id ?? null,
    display_name: row.display_name || null,
    initials: row.initials || null,
    parent_id: row.parent_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleCommentCreate(body) {
  const taskId = parsePositiveInt(body.task_id, "task_id");
  const content = requiredString(body.content, "content");

  const userId = body.user_id ? String(body.user_id).trim() : null;
  if (!userId) {
    throw new Error("user_id is required");
  }

  const resolved = await resolveCommentUser(userId);
  if (!resolved.display_name) {
    throw new Error("user_id must be a valid auth user UUID");
  }

  let parentId = null;
  if (body.parent_id !== undefined && body.parent_id !== null && body.parent_id !== "") {
    parentId = parsePositiveInt(body.parent_id, "parent_id");

    const parent = await sql`
      SELECT id, parent_id FROM public.task_comments
      WHERE id = ${parentId} AND task_id = ${taskId}
      LIMIT 1
    `;
    if (!parent.length) {
      throw new Error(`parent_id ${parentId} not found on this task`);
    }
    if (parent[0].parent_id !== null) {
      throw new Error("Cannot reply to a reply. Only top-level comments support replies.");
    }
  }

  const rows = await sql`
    INSERT INTO public.task_comments (task_id, user_id, display_name, initials, content, parent_id)
    VALUES (${taskId}, ${userId}, ${resolved.display_name}, ${resolved.initials}, ${content}, ${parentId})
    RETURNING *
  `;

  const comment = rows[0];

  await logMentions(taskId, comment.id, content, userId, resolved.display_name);

  return { data: mapComment(comment) };
}

export async function handleCommentUpdate(body) {
  const id = parsePositiveInt(body.id, "id");
  const content = requiredString(body.content, "content");

  const rows = await sql`
    UPDATE public.task_comments
    SET content = ${content}, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;

  if (!rows.length) {
    throw new Error(`Comment ${id} not found`);
  }

  return { data: mapComment(rows[0]) };
}

export async function handleCommentDelete(body) {
  const id = parsePositiveInt(body.id, "id");

  const rows = await sql`
    DELETE FROM public.task_comments
    WHERE id = ${id}
    RETURNING id
  `;

  if (!rows.length) {
    throw new Error(`Comment ${id} not found`);
  }

  return { deleted: true, id: rows[0].id };
}
