import { getAccessToken, ghlFetch, supabase, vault } from "./ghl-client.ts";
import { ghlJsonOrThrow } from "./push-task.ts";

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

  const res = ghlId
    ? await ghlFetch(`/contacts/${ghlId}`, token, {
        method: "PUT",
        body: JSON.stringify(body),
      })
    : await ghlFetch("/contacts/", token, {
        method: "POST",
        body: JSON.stringify(body),
      });

  const data = await ghlJsonOrThrow(
    res,
    ghlId ? "GHL update contact" : "GHL create contact"
  );

  const newGhlId =
    ghlId ??
    (data.contact as { id?: string } | undefined)?.id ??
    (data.id as string | undefined);

  if (!newGhlId) throw new Error("GHL contact response missing id");

  await markRowSyncedFromGhl("contacts", record.id as string, String(newGhlId));

  return { ghl_id: String(newGhlId), action: ghlId ? "updated" : "created" };
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
