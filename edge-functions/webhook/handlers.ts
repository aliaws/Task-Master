import {
  getAccessToken,
  ghlFetch,
  loadCompletedStatusMap,
  loadSupabaseToGhlUserMap,
  supabase,
  vault,
} from "./ghl-client.ts";

type TaskRow = Record<string, unknown>;
type ContactRow = Record<string, unknown>;

async function markRowSyncedFromGhl(
  table: "tasks" | "contacts",
  id: string | number,
  ghlId: string,
  extra: Record<string, unknown> = {}
) {
  const { error } = await supabase
    .from(table)
    .update({
      ghl_id: ghlId,
      data_source: "ghl",
      updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function pushContactToGhl(record: ContactRow) {
  const token = await getAccessToken();
  const v = await vault();
  const locationId = v.locationId;

  if (!locationId) throw new Error("Missing locationId in vault");

  const body = {
    locationId,
    firstName: record.first_name ?? undefined,
    lastName: record.last_name ?? undefined,
    email: record.email ?? undefined,
    phone: record.phone ?? undefined,
  };

  const ghlId = record.ghl_id as string | null | undefined;

  let res: Response;
  if (ghlId) {
    res = await ghlFetch(`/contacts/${ghlId}`, token, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  } else {
    res = await ghlFetch("/contacts/", token, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "message" in data
        ? String((data as { message: string }).message)
        : JSON.stringify(data)
    );
  }

  const newGhlId =
    ghlId ??
    (data as { contact?: { id?: string }; id?: string })?.contact?.id ??
    (data as { id?: string })?.id;

  if (!newGhlId) throw new Error("GHL contact response missing id");

  await markRowSyncedFromGhl("contacts", record.id as string, String(newGhlId));

  return { ghl_id: String(newGhlId), action: ghlId ? "updated" : "created" };
}

export async function pushTaskToGhl(record: TaskRow) {
  const token = await getAccessToken();
  const [{ statusToCompleted }, userMap] = await Promise.all([
    loadCompletedStatusMap(),
    loadSupabaseToGhlUserMap(),
  ]);

  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("id, ghl_id")
    .eq("id", record.contact_id as string)
    .maybeSingle();

  if (contactErr) throw new Error(contactErr.message);
  if (!contact?.ghl_id) {
    throw new Error("Task contact has no ghl_id; sync contact to GHL first");
  }

  const statusId = Number(record.status_id);
  const completed = Boolean(statusToCompleted[statusId]);

  const assignedTo = record.assigned_to
    ? userMap[String(record.assigned_to)] ?? undefined
    : undefined;

  const body: Record<string, unknown> = {
    title: record.title,
    body: record.description ?? undefined,
    dueDate: record.due_date ?? undefined,
    completed,
    priority: record.priority ?? "Medium",
  };

  if (assignedTo) body.assignedTo = assignedTo;

  const ghlContactId = contact.ghl_id;
  const ghlTaskId = record.ghl_id as string | null | undefined;

  let res: Response;
  if (ghlTaskId) {
    res = await ghlFetch(
      `/contacts/${ghlContactId}/tasks/${ghlTaskId}`,
      token,
      { method: "PUT", body: JSON.stringify(body) }
    );
  } else {
    res = await ghlFetch(`/contacts/${ghlContactId}/tasks`, token, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "message" in data
        ? String((data as { message: string }).message)
        : JSON.stringify(data)
    );
  }

  const newGhlId =
    ghlTaskId ??
    (data as { task?: { id?: string }; id?: string })?.task?.id ??
    (data as { id?: string })?.id;

  if (!newGhlId) throw new Error("GHL task response missing id");

  await markRowSyncedFromGhl("tasks", record.id as number, String(newGhlId));

  return {
    ghl_id: String(newGhlId),
    action: ghlTaskId ? "updated" : "created",
    ghl_contact_id: ghlContactId,
  };
}

/** GHL users are synced inbound only; outbound updates metadata when ghl_id exists. */
export async function pushUserToGhl(record: Record<string, unknown>) {
  const ghlId = record.ghl_id as string | undefined;
  if (!ghlId) {
    return {
      skipped: true,
      reason: "User has no ghl_id in metadata; run sync-ghl?sync=users first",
    };
  }

  return {
    ghl_id: ghlId,
    action: "noop",
    reason:
      "GHL location users are read-only in this integration; inbound sync only",
  };
}
