import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const GHL_BASE_URL = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";

export const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export async function vault(): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc("get_vault_secrets", { names: [] });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, string>;
}

export async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.rpc("get_token_health");
  if (error) throw new Error(error.message);
  if (!data?.access_token) throw new Error("No GHL access token");
  return data.access_token as string;
}

export async function loadCompletedStatusMap(): Promise<{
  statusToCompleted: Record<number, boolean>;
}> {
  const { data, error } = await supabase
    .from("task_boards")
    .select("id, is_completed");

  if (error) throw error;

  const statusToCompleted: Record<number, boolean> = {};
  for (const row of data ?? []) {
    statusToCompleted[row.id] = Boolean(row.is_completed);
  }
  return { statusToCompleted };
}

/** Supabase auth user id → GHL user id (from sync). */
export async function loadSupabaseToGhlUserMap(): Promise<Record<string, string>> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const map: Record<string, string> = {};
  let page = 1;

  while (true) {
    const res = await fetch(
      `${url}/auth/v1/admin/users?page=${page}&per_page=1000`,
      { headers: { Authorization: `Bearer ${key}`, apikey: key } }
    );

    if (!res.ok) break;

    const json = await res.json();
    const batch = json?.users ?? [];

    for (const u of batch) {
      const ghlId = u?.user_metadata?.ghl_id;
      if (ghlId && u.id) map[u.id] = String(ghlId);
    }

    if (batch.length < 1000) break;
    page++;
  }

  return map;
}
