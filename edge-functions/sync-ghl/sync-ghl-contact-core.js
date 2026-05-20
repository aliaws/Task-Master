import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CHECKPOINT_KEY_CONTACT,
  CONTACT_PAGE_LIMIT,
  GHL_API_VERSION,
  GHL_BASE_URL,
} from "./sync-constants.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

export async function vault() {
  const { data } = await supabase.rpc("get_vault_secrets", {
    names: [],
  });
  return data ?? {};
}

export async function getToken() {
  const { data, error } = await supabase.rpc("get_token_health");

  if (error) throw error;
  if (!data?.access_token) throw new Error("No token");

  return data;
}

function parseSearchAfter(value) {
  if (value == null || value === "") return null;

  if (Array.isArray(value) && value.length === 2) return value;

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length === 2) return parsed;
  } catch {
    return null;
  }

  return null;
}

function serializeSearchAfter(searchAfter) {
  if (!searchAfter) return null;
  return JSON.stringify(searchAfter);
}

function getLastContactSearchAfter(contacts) {
  if (!contacts.length) return null;

  const last = contacts[contacts.length - 1];
  const sa = last?.searchAfter;

  if (!Array.isArray(sa) || sa.length !== 2) return null;

  return sa;
}

function toGhlDate(value) {
  if (value == null) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function extractTotalAvailable(data) {
  const total = data?.total ?? data?.meta?.total ?? data?.count;
  return total != null ? Number(total) : null;
}

function hasSavedCursor(data) {
  return parseSearchAfter(data?.last_cursor) != null;
}

async function getCheckPoint(checkpointKey = CHECKPOINT_KEY_CONTACT) {
  const { data, error } = await supabase
    .from("sync_checkpoints")
    .select("*")
    .eq("key", checkpointKey)
    .maybeSingle();

  if (error) throw error;

  const isInitialSync = !hasSavedCursor(data);
  const totalSavedContacts = data?.total_saved_contacts || 0;
  const totalAvailableContacts = data?.total_available_contacts || 0;
  const searchAfter = isInitialSync
    ? null
    : parseSearchAfter(data.last_cursor);

  return {
    totalSavedContacts,
    searchAfter,
    totalAvailableContacts,
    isInitialSync,
  };
}

async function saveCheckPoint(
  totalSavedContacts,
  searchAfter,
  checkpointKey = CHECKPOINT_KEY_CONTACT,
  totalAvailableContacts = undefined
) {
  const row = {
    key: checkpointKey,
    total_saved_contacts: totalSavedContacts,
    last_cursor: serializeSearchAfter(searchAfter),
  };

  if (totalAvailableContacts !== undefined) {
    row.total_available_contacts = totalAvailableContacts;
  }

  const { data: existing, error: readError } = await supabase
    .from("sync_checkpoints")
    .select("key")
    .eq("key", checkpointKey)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    const { error } = await supabase
      .from("sync_checkpoints")
      .update(row)
      .eq("key", checkpointKey);

    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("sync_checkpoints").insert(row);
  if (error) throw error;
}

async function fetchContactsFromGhl(token, locationId, searchAfter = null) {
  const payload = {
    locationId,
    pageLimit: CONTACT_PAGE_LIMIT,
    sort: [
      {
        field: "dateUpdated",
        direction: "asc",
      },
    ],
  };

  if (searchAfter) {
    payload.searchAfter = searchAfter;
  }

  const res = await fetch(`${GHL_BASE_URL}/contacts/search`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Version: GHL_API_VERSION,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function syncContacts(
  token,
  locationId,
  checkpointKey = CHECKPOINT_KEY_CONTACT
) {
  const checkpoint = await getCheckPoint(checkpointKey);

  let totalSavedContacts = checkpoint.totalSavedContacts;
  let totalAvailableContacts = checkpoint.totalAvailableContacts;
  let searchAfter = checkpoint.searchAfter;
  const isInitialSync = checkpoint.isInitialSync;

  let synced = 0;
  let capturedAvailableTotal = false;

  while (true) {
    const data = await fetchContactsFromGhl(token, locationId, searchAfter);
    const contacts = data.contacts || [];

    let availableToSave = undefined;

    if (isInitialSync && !capturedAvailableTotal) {
      const availableFromApi = extractTotalAvailable(data);
      if (availableFromApi != null) {
        totalAvailableContacts = availableFromApi;
        capturedAvailableTotal = true;
        availableToSave = totalAvailableContacts;
      }
    }

    if (!contacts.length) {
      await saveCheckPoint(
        totalSavedContacts,
        searchAfter,
        checkpointKey,
        availableToSave
      );
      break;
    }

    const formatted = contacts.map((c) => ({
      ghl_id: c.id,
      first_name: c.firstName || null,
      last_name: c.lastName || null,
      email: c.email || null,
      phone: c.phone || null,
      ghl_date_updated: c.dateUpdated ? toGhlDate(c.dateUpdated) : null,
    }));

    const { error } = await supabase
      .from("contacts")
      .upsert(formatted, { onConflict: "ghl_id" });

    if (error) throw error;

    synced += contacts.length;
    totalSavedContacts += contacts.length;

    const lastSearchAfter = getLastContactSearchAfter(contacts);
    if (!lastSearchAfter) {
      throw new Error(
        "Last contact in batch is missing searchAfter — cannot paginate"
      );
    }

    searchAfter = lastSearchAfter;

    await saveCheckPoint(
      totalSavedContacts,
      searchAfter,
      checkpointKey,
      availableToSave
    );

    if (contacts.length < CONTACT_PAGE_LIMIT) break;
  }

  const caughtUp =
    totalAvailableContacts > 0 && totalSavedContacts >= totalAvailableContacts;

  return {
    success: true,
    synced,
    totalSavedContacts,
    totalAvailableContacts,
    searchAfter,
    lastCursor: serializeSearchAfter(searchAfter),
    isInitialSync,
    caughtUp,
    done: true,
  };
}
