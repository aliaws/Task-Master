import {
  getAccessToken,
  loadCompletedStatusMap,
  loadSupabaseToGhlUserMap,
  supabase,
} from "./ghl-client.ts";
import {
  buildGhlTaskCreatePayload,
  buildGhlTaskUpdatePayload,
  type DbTaskRow,
  serializeGhlPayload,
} from "./ghl-payloads.ts";
import {
  extractGhlTaskId,
  ghlFetch,
  ghlJsonOrThrow,
} from "./ghl-http.ts";

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

export async function fetchTaskForPush(taskId: number): Promise<DbTaskRow> {
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select(
      "id, title, description, due_date, status_id, assigned_to, ghl_id, contact_id, data_source"
    )
    .eq("id", taskId)
    .maybeSingle();

  if (taskErr) throw new Error(taskErr.message);
  if (!task) throw new Error(`Task ${taskId} not found`);

  let contactGhlId: string | null = null;
  if (task.contact_id) {
    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("ghl_id")
      .eq("id", task.contact_id)
      .maybeSingle();

    if (contactErr) throw new Error(contactErr.message);
    contactGhlId = contact?.ghl_id ?? null;
  }

  return { ...task, contact_ghl_id: contactGhlId } as DbTaskRow;
}

async function markTaskSynced(taskId: number, ghlId: string) {
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

export async function pushTaskToGhl(webhookRecord: { id: unknown }) {
  const taskId = Number(webhookRecord.id);
  if (!Number.isInteger(taskId)) throw new Error("Invalid task id");

  const row = await fetchTaskForPush(taskId);

  if (row.data_source === "ghl") {
    return {
      skipped: true,
      reason: "data_source is ghl (inbound sync)",
    };
  }

  const contactGhlId = row.contact_ghl_id;
  if (!contactGhlId) {
    throw new Error(
      "Task contact has no ghl_id; push the contact to GHL first"
    );
  }

  const token = await getAccessToken();
  const [{ statusToCompleted }, userMap] = await Promise.all([
    loadCompletedStatusMap(),
    loadSupabaseToGhlUserMap(),
  ]);

  const statusId = Number(row.status_id);
  const completed = Boolean(statusToCompleted[statusId]);
  const assignedToGhl = await resolveAssignedToGhlId(row.assigned_to, userMap);

  const ghlTaskId = row.ghl_id ? String(row.ghl_id) : null;
  const isCreate = !ghlTaskId;

  const ghlPayload = isCreate
    ? buildGhlTaskCreatePayload(row, completed, assignedToGhl)
    : buildGhlTaskUpdatePayload(row, completed, assignedToGhl);

  const path = isCreate
    ? `/contacts/${contactGhlId}/tasks`
    : `/contacts/${contactGhlId}/tasks/${ghlTaskId}`;
  const method = isCreate ? "POST" : "PUT";

  const res = await ghlFetch(path, token, {
    method,
    body: serializeGhlPayload(ghlPayload as Record<string, unknown>),
  });

  const data = await ghlJsonOrThrow(
    res,
    isCreate ? "GHL create task" : "GHL update task"
  );

  const newGhlId = ghlTaskId ?? extractGhlTaskId(data);
  if (!newGhlId) {
    throw new Error(`GHL task response missing id: ${JSON.stringify(data)}`);
  }

  await markTaskSynced(taskId, newGhlId);

  return {
    ghl_id: newGhlId,
    action: isCreate ? "created" : "updated",
    ghl_contact_id: contactGhlId,
    ghl_method: method,
    ghl_path: path,
    ghl_payload: ghlPayload,
  };
}
