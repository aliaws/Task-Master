import {
  extractGhlContactId,
  getAccessToken,
  ghlFetch,
  ghlJsonOrThrow,
  supabase,
  vault,
} from "./ghl-client.ts";
import {
  buildGhlContactCreatePayload,
  buildGhlContactUpdatePayload,
  type DbContactRow,
  serializeGhlPayload,
} from "./ghl-payloads.ts";

function str(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

export async function fetchContactForPush(
  contactId: string
): Promise<DbContactRow> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, ghl_id, first_name, last_name, email, phone, data_source")
    .eq("id", contactId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Contact ${contactId} not found`);
  return data as DbContactRow;
}

async function markContactSynced(contactId: string, ghlId: string) {
  const { error } = await supabase
    .from("contacts")
    .update({
      ghl_id: ghlId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);

  if (error) throw new Error(error.message);
}

export async function deleteContactFromGhl(
  webhookRecord: Record<string, unknown>
) {
  const contactId = String(webhookRecord.id);
  const ghlId = str(webhookRecord.ghl_id);

  if (!ghlId) {
    return {
      skipped: true,
      reason: "Contact has no ghl_id; not synced to GHL yet",
    };
  }

  const token = await getAccessToken();
  const path = `/contacts/${ghlId}`;
  const res = await ghlFetch(path, token, { method: "DELETE" });
  await ghlJsonOrThrow(res, "GHL delete contact");

  return {
    ghl_id: ghlId,
    action: "deleted",
    ghl_method: "DELETE",
    ghl_path: path,
  };
}

export async function pushContactToGhl(webhookRecord: { id: unknown }) {
  const contactId = String(webhookRecord.id);
  const row = await fetchContactForPush(contactId);

  const token = await getAccessToken();
  const { locationId } = await vault();
  const ghlId = str(row.ghl_id);
  const isCreate = !ghlId;

  const ghlPayload = isCreate
    ? buildGhlContactCreatePayload(row, locationId ?? "")
    : buildGhlContactUpdatePayload(row);

  const path = isCreate ? "/contacts/" : `/contacts/${ghlId}`;
  const method = isCreate ? "POST" : "PUT";

  const res = await ghlFetch(path, token, {
    method,
    body: serializeGhlPayload(ghlPayload as Record<string, unknown>),
  });

  const data = await ghlJsonOrThrow(
    res,
    isCreate ? "GHL create contact" : "GHL update contact"
  );

  const newGhlId = ghlId ?? extractGhlContactId(data);
  if (!newGhlId) throw new Error("GHL contact response missing id");

  await markContactSynced(contactId, newGhlId);

  return {
    ghl_id: newGhlId,
    action: isCreate ? "created" : "updated",
    ghl_method: method,
    ghl_path: path,
    ghl_payload: ghlPayload,
  };
}
