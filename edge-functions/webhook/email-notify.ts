import { sql } from "./email-db.ts";
import { resolveCallerFromUserId, type TaskCaller } from "./email-caller.ts";
import { sendSmtpEmail } from "./email-smtp.ts";
import { shouldSkipTaskChangeLog } from "./loop-guard.ts";

const WATCHED_FIELDS: Record<string, string> = {
  priority: "priority_changed",
  assigned_to: "assigned_to_changed",
  due_date: "due_date_changed",
  status_id: "status_changed",
};

const LOGGED_FIELD_KEYS = [
  "title",
  "description",
  "priority",
  "status_id",
  "due_date",
  "assigned_to",
  "contact_id",
  "tags",
  "subtasks",
  "attachments",
] as const;

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  priority: "Priority",
  assigned_to: "Assignee",
  due_date: "Due date",
  status_id: "Status",
  contact_id: "Contact",
  tags: "Tags",
  subtasks: "Subtasks",
  attachments: "Attachments",
};

const HEADLINES: Record<string, string> = {
  priority_changed: "{{changed_by_name}} updated the priority",
  assigned_to_changed: "{{changed_by_name}} assigned you to this task",
  due_date_changed: "{{changed_by_name}} updated the due date",
  status_changed: "{{changed_by_name}} updated the status",
};

const JSON_FIELDS = new Set(["tags", "subtasks", "attachments"]);

type LoggedChange = {
  field: string;
  emailTemplateKey?: string;
  oldVal: unknown;
  newVal: unknown;
};

type TaskSnapshot = {
  assigned_to?: string | null;
};

function toPositiveInt(value: unknown, label: string): number {
  const n =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "string"
        ? Number(value.trim())
        : Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return n;
}

function fieldValuesEqual(field: string, a: unknown, b: unknown) {
  if (a == null && b == null) return true;
  if (JSON_FIELDS.has(field)) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  if (field === "due_date" || field === "time_start_at") {
    const left = a ? new Date(String(a)).toISOString() : null;
    const right = b ? new Date(String(b)).toISOString() : null;
    return left === right;
  }
  return String(a ?? "") === String(b ?? "");
}

function detectLoggedChanges(
  oldRecord: Record<string, unknown>,
  record: Record<string, unknown>
): LoggedChange[] {
  const changes: LoggedChange[] = [];
  for (const field of LOGGED_FIELD_KEYS) {
    const oldVal = oldRecord[field];
    const newVal = record[field];
    if (fieldValuesEqual(field, oldVal, newVal)) continue;
    changes.push({
      field,
      emailTemplateKey: WATCHED_FIELDS[field],
      oldVal,
      newVal,
    });
  }
  return changes;
}

function snapshotFromRecord(record: Record<string, unknown>): TaskSnapshot {
  return {
    assigned_to:
      record.assigned_to != null ? String(record.assigned_to) : null,
  };
}

function appBaseUrl() {
  return (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
}

/** View Task link — keeps notification_id for backward-compatible email URLs. */
function taskUrl(taskId: unknown, logId: unknown) {
  const base = appBaseUrl();
  if (!base) {
    throw new Error("APP_BASE_URL is not set — cannot build View Task link");
  }
  const url = new URL("/", `${base}/`);
  url.searchParams.set("task", String(toPositiveInt(taskId, "task id")));
  url.searchParams.set("from", "kanban");
  url.searchParams.set(
    "notification_id",
    String(toPositiveInt(logId, "log id"))
  );
  return url.href;
}

function formatDueDate(value: unknown) {
  if (value == null || value === "") return "None";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatChangedAt(date = new Date()) {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatJsonField(value: unknown) {
  if (value == null) return "None";
  if (Array.isArray(value)) return `${value.length} item(s)`;
  const s = JSON.stringify(value);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

async function loadTaskContext(taskId: number) {
  const rows = await sql<
    { title: string | null; last_changed_by_user_id: string | null }[]
  >`
    SELECT title, last_changed_by_user_id
    FROM public.tasks
    WHERE id = ${taskId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function loadStatusName(statusId: unknown) {
  if (statusId == null) return "None";
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM public.task_boards WHERE id = ${statusId} LIMIT 1
  `;
  return rows[0]?.name ?? `Board #${statusId}`;
}

async function loadUserSummary(userId: unknown) {
  if (!userId) return { name: "Unassigned", email: null as string | null };
  const rows = await sql<{ display_name: string; email: string | null }[]>`
    SELECT
      email,
      COALESCE(
        NULLIF(
          TRIM(
            CONCAT_WS(
              ' ',
              raw_user_meta_data->>'first_name',
              raw_user_meta_data->>'last_name'
            )
          ),
          ''
        ),
        split_part(email, '@', 1)
      ) AS display_name
    FROM auth.users
    WHERE id = ${userId}
    LIMIT 1
  `;
  if (!rows.length) return { name: "Unknown user", email: null };
  return { name: rows[0].display_name, email: rows[0].email ?? null };
}

async function loadContactName(contactId: unknown) {
  if (!contactId) return "None";
  const rows = await sql<{ display_name: string }[]>`
    SELECT COALESCE(
      NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''),
      email
    ) AS display_name
    FROM public.contacts
    WHERE id = ${contactId}
    LIMIT 1
  `;
  return rows[0]?.display_name ?? String(contactId);
}

async function resolveDisplayValue(field: string, value: unknown) {
  if (field === "status_id") return loadStatusName(value);
  if (field === "assigned_to") return (await loadUserSummary(value)).name;
  if (field === "contact_id") return loadContactName(value);
  if (field === "due_date" || field === "time_start_at") return formatDueDate(value);
  if (JSON_FIELDS.has(field)) return formatJsonField(value);
  if (value == null || value === "") return "None";
  return String(value);
}

function renderTemplate(template: string, vars: Record<string, unknown>) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return out;
}

async function loadEmailTemplate(templateKey: string) {
  const rows = await sql<
    { subject_template: string; body_html_template: string }[]
  >`
    SELECT subject_template, body_html_template
    FROM public.email_templates
    WHERE template_key = ${templateKey}
      AND is_active = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function insertTaskChangeLog(row: {
  request_id: string;
  task_id: number;
  field_name: string;
  old_display_value: string;
  new_display_value: string;
  old_value: unknown;
  new_value: unknown;
  changed_by_user_id: string | null;
  changed_by_name: string;
  email_template_key: string | null;
  recipient_email: string | null;
  email_subject: string | null;
  email_status: string;
}) {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO public.task_change_logs (
      request_id,
      task_id,
      field_name,
      old_display_value,
      new_display_value,
      old_value,
      new_value,
      changed_by_user_id,
      changed_by_name,
      email_template_key,
      recipient_email,
      email_subject,
      email_status
    ) VALUES (
      ${row.request_id},
      ${row.task_id},
      ${row.field_name},
      ${row.old_display_value},
      ${row.new_display_value},
      ${row.old_value == null ? null : sql.json(row.old_value)},
      ${row.new_value == null ? null : sql.json(row.new_value)},
      ${row.changed_by_user_id},
      ${row.changed_by_name},
      ${row.email_template_key},
      ${row.recipient_email},
      ${row.email_subject},
      ${row.email_status}
    )
    RETURNING id
  `;
  const rawId = rows[0]?.id;
  if (rawId == null) return undefined;
  return toPositiveInt(rawId, "log id");
}

async function updateTaskChangeLogEmail(
  id: number,
  patch: {
    email_status?: string;
    email_provider_message_id?: string | null;
    email_error_message?: string | null;
    email_sent_at?: string | null;
  }
) {
  await sql`
    UPDATE public.task_change_logs
    SET
      email_status = COALESCE(${patch.email_status ?? null}, email_status),
      email_provider_message_id = COALESCE(
        ${patch.email_provider_message_id ?? null},
        email_provider_message_id
      ),
      email_error_message = ${patch.email_error_message ?? null},
      email_sent_at = COALESCE(${patch.email_sent_at ?? null}, email_sent_at)
    WHERE id = ${id}
  `;
}

async function resolveRecipientEmail(
  change: LoggedChange,
  afterTask: TaskSnapshot
) {
  if (change.field === "assigned_to") {
    return (await loadUserSummary(change.newVal)).email;
  }
  return (await loadUserSummary(afterTask.assigned_to)).email;
}

async function processChange({
  requestId,
  taskId,
  taskTitle,
  change,
  caller,
  afterTask,
}: {
  requestId: string;
  taskId: number;
  taskTitle: string;
  change: LoggedChange;
  caller: TaskCaller;
  afterTask: TaskSnapshot;
}) {
  const changedByName = caller.name || "Someone";
  const [oldDisplay, newDisplay] = await Promise.all([
    resolveDisplayValue(change.field, change.oldVal),
    resolveDisplayValue(change.field, change.newVal),
  ]);

  const isEmailField = Boolean(change.emailTemplateKey);
  let recipientEmail: string | null = null;
  let emailSubject: string | null = null;
  let emailStatus = "not_applicable";

  if (isEmailField) {
    recipientEmail = await resolveRecipientEmail(change, afterTask);
    emailStatus = recipientEmail ? "pending" : "skipped";
    emailSubject = recipientEmail
      ? null
      : `[skipped] ${taskTitle}`;
  }

  const logId = await insertTaskChangeLog({
    request_id: requestId,
    task_id: taskId,
    field_name: change.field,
    old_display_value: oldDisplay,
    new_display_value: newDisplay,
    old_value: change.oldVal,
    new_value: change.newVal,
    changed_by_user_id: caller.id,
    changed_by_name: changedByName,
    email_template_key: change.emailTemplateKey ?? null,
    recipient_email: recipientEmail ?? (isEmailField ? "skipped@notifications.local" : null),
    email_subject: emailSubject,
    email_status: emailStatus,
  });

  if (!logId || !isEmailField || !recipientEmail) return 0;

  const template = await loadEmailTemplate(change.emailTemplateKey!);
  if (!template) {
    throw new Error(`Email template not found: ${change.emailTemplateKey}`);
  }

  const changedAt = formatChangedAt();
  const baseVars = {
    changed_by_name: changedByName,
    headline: renderTemplate(HEADLINES[change.emailTemplateKey!], {
      changed_by_name: changedByName,
      new_value: newDisplay,
    }),
    task_title: taskTitle,
    field_label: FIELD_LABELS[change.field],
    old_value: oldDisplay,
    new_value: newDisplay,
    changed_at: changedAt,
  };
  emailSubject = renderTemplate(template.subject_template, baseVars);

  await sql`
    UPDATE public.task_change_logs
    SET email_subject = ${emailSubject}
    WHERE id = ${logId}
  `;

  try {
    const html = renderTemplate(template.body_html_template, {
      ...baseVars,
      task_url: taskUrl(taskId, logId),
    });
    const messageId = await sendSmtpEmail({
      to: recipientEmail,
      subject: emailSubject,
      html,
    });
    await updateTaskChangeLogEmail(logId, {
      email_status: "sent",
      email_provider_message_id: messageId,
      email_sent_at: new Date().toISOString(),
      email_error_message: null,
    });
    return 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`task change log ${logId} email failed:`, message);
    try {
      await updateTaskChangeLogEmail(logId, {
        email_status: "failed",
        email_error_message: message,
      });
    } catch (updateErr) {
      console.error(`failed to mark log ${logId} as failed:`, updateErr);
    }
    return 0;
  }
}

export async function handleTaskEmailFromDbWebhook(
  record: Record<string, unknown>,
  oldRecord: Record<string, unknown> | null
) {
  const skip = shouldSkipTaskChangeLog(record, oldRecord);
  if (skip.skip) {
    return { skipped: true, reason: skip.reason };
  }

  if (String(record.data_source ?? "") !== "task_master") {
    return { skipped: true, reason: "not task_master" };
  }

  const taskId = Number(record.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Error("Invalid task id in webhook record");
  }

  const changes = detectLoggedChanges(oldRecord!, record);
  if (!changes.length) {
    return { skipped: true, reason: "no logged field changes" };
  }

  const requestId = crypto.randomUUID();
  const taskRow = await loadTaskContext(taskId);
  const caller = await resolveCallerFromUserId(
    taskRow?.last_changed_by_user_id ?? record.last_changed_by_user_id
  );
  const afterTask = snapshotFromRecord(record);
  const taskTitle =
    taskRow?.title ??
    (record.title != null ? String(record.title) : null) ??
    `Task #${taskId}`;

  let emailed = 0;
  for (const change of changes) {
    emailed += await processChange({
      requestId,
      taskId,
      taskTitle,
      change,
      caller,
      afterTask,
    });
  }

  return { processed: changes.length, emailed };
}
