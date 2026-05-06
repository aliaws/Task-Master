import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const LIMIT = 100;
const MAX_PAGES = 50;

// --------------------
// VAULT
// --------------------
async function vault() {
  const { data } = await supabase.rpc("get_vault_secrets", {
    names: [],
  });
  return data ?? {};
}

// --------------------
// TOKEN
// --------------------
async function getToken() {
  const { data, error } = await supabase.rpc("get_token_health");

  if (error) throw error;
  if (!data?.access_token) throw new Error("No token");

  return data;
}

// --------------------
// STATE
// --------------------
async function getState() {
  const { data } = await supabase
    .from("sync_state")
    .select("*")
    .eq("type", "contacts")
    .maybeSingle();

  return data;
}

async function updateState(page: number) {
  await supabase.from("sync_state").upsert({
    type: "contacts",
    last_cursor: String(page),
    last_sync: new Date().toISOString(),
  });
}

// --------------------
// FETCH
// --------------------
async function fetchContacts(token: string, locationId: string, page: number) {
  const res = await fetch(
    "https://services.leadconnectorhq.com/contacts/search",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Version: "2021-07-28",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        locationId,
        page,
        pageLimit: LIMIT,
      }),
    }
  );

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --------------------
// SYNC
// --------------------
async function syncContacts(token: string, locationId: string) {
  const state = await getState();
  let page = Number(state?.last_cursor || 1);

  let total = 0;
  let total_pages = 1;

  for (let i = 0; i < MAX_PAGES; i++) {
    const data = await fetchContacts(token, locationId, page);
    total_pages = Math.ceil(data.total/LIMIT);

    const contacts = data.contacts || [];

    if (!contacts.length) break;

    const formatted = contacts.map((c: any) => ({
      ghl_id: c.id,
      first_name: c.firstName || null,
      last_name: c.lastName || null,
      email: c.email || null,
      phone: c.phone || null,
      avatar_url: c.avatar || null,
      updated_at: c.updatedAt || null,
    }));

    const { error } = await supabase
      .from("contacts")
      .upsert(formatted, { onConflict: "ghl_id" });

    if (error) throw error;

    total += contacts.length;
    page++;

    await updateState(page);

    if (contacts.length < LIMIT) break;
  }

  return {
    success: true,
    synced: total,
    done: true,
  };
}

// --------------------
// MAIN
// --------------------
serve(async () => {
  try {
    const v = await vault();
    const token = await getToken();

    const result = await syncContacts(
      token.access_token,
      v.locationId
    );

    return Response.json(result);
  } catch (e) {
    return Response.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
});
