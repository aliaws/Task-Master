import { sql } from "./email-db.ts";
import { sendSmtpEmail } from "./email-smtp.ts";
import { shouldSkipOutbound } from "./loop-guard.ts";

const DEFAULT_CALLER = { id: null, name: "Someone", email: null };

const WATCHED_FIELD_KEYS = [
  "priority",
  "assigned_to",
  "due_date",
  "status_id",
] as const;

const WATCHED_FIELDS: Record<string, string> = {
  priority: "priority_changed",
  assigned_to: "assigned_to_changed",
  due_date: "due_date_changed",
  status_id: "status_changed",
};

const FIELD_LABELS: Record<string, string> = {
  priority: "Priority",
  assigned_to: "Assignee",
  due_date: "Due date",
  status_id: "Status",
};

const HEADLINES: Record<string, string> = {
  priority_changed: "{{changed_by_name}} updated the priority",
  assigned_to_changed: "{{changed_by_name}} assigned you to this task",
  due_date_changed: "{{changed_by_name}} updated the due date",
  status_changed: "{{changed_by_name}} updated the status",
};

type TaskSnapshot = {
  id?: number;
  title?: string | null;
  priority?: string | null;
  status_id?: number | null;
  assigned_to?: string | null;
  due_date?: string | null;
};

type DetectedChange = {
  field: string;
  templateKey: string;
  oldVal: unknown;
  newVal: unknown;
};

function snapshotFromRecord(record: Record<string, unknown>): TaskSnapshot {
  return {
    id: record.id != null ? Number(record.id) : undefined,
    title: record.title != null ? String(record.title) : null,
    priority: record.priority != null ? String(record.priority) : null,
    status_id: record.status_id != null ? Number(record.status_id) : null,
    assigned_to: record.assigned_to != null ? String(record.assigned_to) : null,
    due_date: record.due_date != null ? String(record.due_date) : null,
  };
}

function buildPatchFromDbRecords(
  oldRecord: Record<string, unknown>,
  record: Record<string, unknown>
) {
  const before = snapshotFromRecord(oldRecord);
  const patch: Record<string, unknown> = {};

  for (const field of WATCHED_FIELD_KEYS) {
    const oldVal = oldRecord[field];
    const newVal = record[field];
    if (fieldValuesEqual(field, oldVal, newVal)) continue;
    patch[field] = newVal;
  }

  return { before, patch };
}

function appBaseUrl() {
  return (
    Deno.env.get("APP_BASE_URL") ??
    Deno.env.get("TASK_APP_BASE_URL") ??
    ""
  ).replace(/\/$/, "");
}

function taskUrl(taskId: number) {
  const base = appBaseUrl();
  if (!base) return `#task-${taskId}`;
  return `${base}/?task=${taskId}&from=kanban`;
}

function fieldValuesEqual(field: string, a: unknown, b: unknown) {
  if (a == null && b == null) return true;
  if (field === "due_date") {
    const left = a ? new Date(String(a)).toISOString() : null;
    const right = b ? new Date(String(b)).toISOString() : null;
    return left === right;
  }
  return String(a ?? "") === String(b ?? "");
}

export function detectWatchedChanges(
  before: TaskSnapshot,
  patch: Record<string, unknown>
) {
  const changes: DetectedChange[] = [];

  for (const [field, templateKey] of Object.entries(WATCHED_FIELDS)) {
    if (!(field in patch)) continue;

    const oldVal = before[field as keyof TaskSnapshot];
    const newVal = patch[field];
    if (fieldValuesEqual(field, oldVal, newVal)) continue;

    changes.push({
      field,
      templateKey,
      oldVal,
      newVal,
    });
  }

  return changes;
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

async function resolveDisplayValue(field: string, value: unknown) {
  if (field === "status_id") return loadStatusName(value);
  if (field === "assigned_to") {
    const u = await loadUserSummary(value);
    return u.name;
  }
  if (field === "due_date") return formatDueDate(value);
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

async function insertNotification(row: {
  request_id: string;
  task_id: number;
  template_key: string;
  field_name: string;
  old_display_value: string;
  new_display_value: string;
  changed_by_user_id: string | null;
  changed_by_name: string;
  recipient_email: string;
  subject: string;
  status: string;
}) {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO public.email_notifications (
      request_id,
      task_id,
      template_key,
      field_name,
      old_display_value,
      new_display_value,
      changed_by_user_id,
      changed_by_name,
      recipient_email,
      subject,
      status
    ) VALUES (
      ${row.request_id},
      ${row.task_id},
      ${row.template_key},
      ${row.field_name},
      ${row.old_display_value},
      ${row.new_display_value},
      ${row.changed_by_user_id},
      ${row.changed_by_name},
      ${row.recipient_email},
      ${row.subject},
      ${row.status}
    )
    RETURNING id
  `;
  return rows[0]?.id;
}

async function updateNotification(
  id: number,
  patch: {
    status?: string;
    provider_message_id?: string | null;
    error_message?: string | null;
    sent_at?: string | null;
  }
) {
  await sql`
    UPDATE public.email_notifications
    SET
      status = COALESCE(${patch.status ?? null}, status),
      provider_message_id = COALESCE(${patch.provider_message_id ?? null}, provider_message_id),
      error_message = ${patch.error_message ?? null},
      sent_at = COALESCE(${patch.sent_at ?? null}, sent_at)
    WHERE id = ${id}
  `;
}

async function resolveRecipientEmail(
  change: DetectedChange,
  afterTask: TaskSnapshot
) {
  if (change.field === "assigned_to") {
    const user = await loadUserSummary(change.newVal);
    return user.email;
  }

  const user = await loadUserSummary(afterTask.assigned_to);
  return user.email;
}

async function sendChangeNotification({
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
  change: DetectedChange;
  caller: { id: string | null; name: string; email: string | null };
  afterTask: TaskSnapshot;
}) {
  const changedByName = caller.name || "Someone";
  const recipientEmail = await resolveRecipientEmail(change, afterTask);
  if (!recipientEmail) {
    await insertNotification({
      request_id: requestId,
      task_id: taskId,
      template_key: change.templateKey,
      field_name: change.field,
      old_display_value: await resolveDisplayValue(change.field, change.oldVal),
      new_display_value: await resolveDisplayValue(change.field, change.newVal),
      changed_by_user_id: caller.id,
      changed_by_name: changedByName,
      recipient_email: "skipped@notifications.local",
      subject: `[skipped] ${taskTitle}`,
      status: "skipped",
    });
    return;
  }

  const [oldDisplay, newDisplay] = await Promise.all([
    resolveDisplayValue(change.field, change.oldVal),
    resolveDisplayValue(change.field, change.newVal),
  ]);

  const changedAt = formatChangedAt();
  const vars = {
    changed_by_name: changedByName,
    actor_name: changedByName,
    headline: renderTemplate(HEADLINES[change.templateKey], {
      changed_by_name: changedByName,
      new_value: newDisplay,
    }),
    task_title: taskTitle,
    field_label: FIELD_LABELS[change.field],
    old_value: oldDisplay,
    new_value: newDisplay,
    changed_at: changedAt,
    task_url: taskUrl(taskId),
  };

  const template = await loadEmailTemplate(change.templateKey);
  if (!template) {
    throw new Error(`Email template not found: ${change.templateKey}`);
  }

  const subject = renderTemplate(template.subject_template, vars);
  const html = renderTemplate(template.body_html_template, vars);

  const notificationId = await insertNotification({
    request_id: requestId,
    task_id: taskId,
    template_key: change.templateKey,
    field_name: change.field,
    old_display_value: oldDisplay,
    new_display_value: newDisplay,
    changed_by_user_id: caller.id,
    changed_by_name: changedByName,
    recipient_email: recipientEmail,
    subject,
    status: "pending",
  });

  if (!notificationId) {
    throw new Error("Failed to insert email notification row");
  }

  try {
    const messageId = await sendSmtpEmail({
      to: recipientEmail,
      subject,
      html,
    });
    await updateNotification(notificationId, {
      status: "sent",
      provider_message_id: messageId,
      sent_at: new Date().toISOString(),
      error_message: null,
    });
  } catch (err) {
    await updateNotification(notificationId, {
      status: "failed",
      error_message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handleTaskEmailFromDbWebhook(
  record: Record<string, unknown>,
  oldRecord: Record<string, unknown> | null
) {
  if (!oldRecord) {
    return { skipped: true, reason: "no old_record (insert)" };
  }

  if (String(record.data_source ?? "") !== "task_master") {
    return { skipped: true, reason: "not task_master" };
  }

  const guard = shouldSkipOutbound(record, oldRecord);
  if (guard.skip) {
    return { skipped: true, reason: guard.reason };
  }

  const taskId = Number(record.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Error("Invalid task id in webhook record");
  }

  const { before, patch } = buildPatchFromDbRecords(oldRecord, record);
  const changes = detectWatchedChanges(before, patch);
  if (!changes.length) {
    return { skipped: true, reason: "no watched field changes" };
  }

  const requestId = crypto.randomUUID();
  const caller = DEFAULT_CALLER;

  const afterTask = { ...before, ...patch } as TaskSnapshot;
  const taskTitle =
    record.title != null
      ? String(record.title)
      : before.title ?? `Task #${taskId}`;

  for (const change of changes) {
    await sendChangeNotification({
      requestId,
      taskId,
      taskTitle,
      change,
      caller,
      afterTask,
    });
  }

  return { processed: changes.length };
}
