import {
  getAccessToken,
  ghlFetch,
  loadCompletedStatusMap,
  loadSupabaseToGhlUserMap,
  supabase,
} from "./ghl-client.ts";

type TaskRow = Record<string, unknown>;

function formatGhlDueDate(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function defaultCreateDueDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(17, 0, 0, 0);
  return d.toISOString();
}

async function resolveAssignedToGhlId(
  assignedTo: unknown,
  userMap: Record<string, string>
): Promise<string | undefined> {
  if (assignedTo == null || assignedTo === "") return undefined;

  const key = String(assignedTo);
  if (userMap[key]) return userMap[key];

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/auth/v1/admin/users/${key}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });

  if (!res.ok) return undefined;

  const user = await res.json();
  const ghlId = user?.user_metadata?.ghl_id;
  return ghlId ? String(ghlId) : undefined;
}

export async function fetchTaskRowForPush(
  taskId: number
): Promise<TaskRow & { contact_ghl_id?: string }> {
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select(
      "id, title, description, due_date, status_id, assigned_to, ghl_id, contact_id, data_source"
    )
    .eq("id", taskId)
    .maybeSingle();

  if (taskErr) throw new Error(taskErr.message);
  if (!task) throw new Error(`Task ${taskId} not found`);

  let contactGhlId: string | undefined;
  if (task.contact_id) {
    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("ghl_id")
      .eq("id", task.contact_id)
      .maybeSingle();

    if (contactErr) throw new Error(contactErr.message);
    contactGhlId = contact?.ghl_id ?? undefined;
  }

  return { ...task, contact_ghl_id: contactGhlId };
}

/** GHL task body — matches LeadConnector create/update task API (no priority). */
export function buildGhlTaskBody(
  record: TaskRow,
  statusToCompleted: Record<number, boolean>,
  assignedToGhl: string | undefined,
  opts: { forCreate: boolean }
): Record<string, string | boolean> {
  const title = String(record.title ?? "").trim();
  if (!title) {
    throw new Error("Task title is required to push to GHL");
  }

  const statusId = Number(record.status_id);
  const completed = Boolean(statusToCompleted[statusId]);

  const dueDate =
    formatGhlDueDate(record.due_date) ??
    (opts.forCreate ? defaultCreateDueDate() : undefined);

  const body: Record<string, string | boolean> = {
    title,
    completed,
  };

  const description = record.description;
  if (description != null && String(description).trim() !== "") {
    body.body = String(description);
  }

  if (dueDate) body.dueDate = dueDate;

  if (assignedToGhl) body.assignedTo = assignedToGhl;

  return body;
}

export async function ghlJsonOrThrow(
  res: Response,
  context: string
): Promise<Record<string, unknown>> {
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `${context} (${res.status}): ${JSON.stringify(data)}`
    );
  }

  return data;
}

export function extractGhlTaskId(data: Record<string, unknown>): string | null {
  const task = data.task as { id?: string } | undefined;
  if (task?.id) return String(task.id);
  if (typeof data.id === "string") return data.id;
  return null;
}

async function markTaskSyncedFromGhl(taskId: number, ghlId: string) {
  const { error } = await supabase
    .from("tasks")
    .update({
      ghl_id: ghlId,
      data_source: "ghl",
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (error) throw new Error(error.message);
}

export async function pushTaskToGhl(record: TaskRow) {
  const taskId = Number(record.id);
  if (!Number.isInteger(taskId)) {
    throw new Error("Invalid task id");
  }

  const row = await fetchTaskRowForPush(taskId);
  const contactGhlId = row.contact_ghl_id;

  if (!contactGhlId) {
    throw new Error(
      "Task contact has no ghl_id; sync or create the contact in GHL first"
    );
  }

  const token = await getAccessToken();
  const [{ statusToCompleted }, userMap] = await Promise.all([
    loadCompletedStatusMap(),
    loadSupabaseToGhlUserMap(),
  ]);

  const assignedToGhl = await resolveAssignedToGhlId(
    row.assigned_to,
    userMap
  );

  const ghlTaskId = row.ghl_id as string | null | undefined;
  const forCreate = !ghlTaskId;

  const ghlBody = buildGhlTaskBody(
    row,
    statusToCompleted,
    assignedToGhl,
    { forCreate }
  );

  const path = ghlTaskId
    ? `/contacts/${contactGhlId}/tasks/${ghlTaskId}`
    : `/contacts/${contactGhlId}/tasks`;

  const res = await ghlFetch(path, token, {
    method: ghlTaskId ? "PUT" : "POST",
    body: JSON.stringify(ghlBody),
  });

  const data = await ghlJsonOrThrow(
    res,
    ghlTaskId ? "GHL update task" : "GHL create task"
  );

  const newGhlId = ghlTaskId ?? extractGhlTaskId(data);
  if (!newGhlId) {
    throw new Error(
      `GHL task response missing id: ${JSON.stringify(data)}`
    );
  }

  await markTaskSyncedFromGhl(taskId, newGhlId);

  return {
    ghl_id: newGhlId,
    action: ghlTaskId ? "updated" : "created",
    ghl_contact_id: contactGhlId,
    ghl_request: ghlBody,
    ghl_response: data,
  };
}
