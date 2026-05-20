import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GHL_API_VERSION, GHL_BASE_URL } from "./sync-constants.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

async function fetchGHLUsers(accessToken, locationId) {
  const res = await fetch(
    `${GHL_BASE_URL}/users/?locationId=${locationId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Version: GHL_API_VERSION,
      },
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error("GHL ERROR:", data);
    throw new Error(data?.message || "Failed to fetch users");
  }

  return data.users || [];
}

async function syncToAuth(users) {
  let created = 0;
  let updated = 0;

  const { data: usersData, error } = await supabase.auth.admin.listUsers();

  if (error) throw error;

  const existingUsers = usersData.users;

  for (const user of users) {
    if (!user.email) continue;

    const existing = existingUsers.find((u) => u.email === user.email);

    if (!existing) {
      const { error: createError } = await supabase.auth.admin.createUser({
        email: user.email,
        email_confirm: true,
        user_metadata: {
          ghl_id: user.id,
          first_name: user.firstName || null,
          last_name: user.lastName || null,
        },
      });

      if (createError) {
        console.error("CREATE ERROR:", user.email, createError.message);
        continue;
      }

      created++;
    } else {
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        existing.id,
        {
          user_metadata: {
            ghl_id: user.id,
            first_name: user.firstName || null,
            last_name: user.lastName || null,
          },
        }
      );

      if (updateError) {
        console.error("UPDATE ERROR:", user.email, updateError.message);
        continue;
      }

      updated++;
    }
  }

  return { created, updated };
}

export async function loadUserMap() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const res = await fetch(`${url}/auth/v1/admin/users`, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
  });

  const json = await res.json();
  const users = json?.users ?? [];
  const map = {};

  for (const u of users) {
    const ghlId = u?.user_metadata?.ghl_id;
    if (ghlId) map[ghlId] = u.id;
  }

  return map;
}

export async function syncUsers(accessToken, locationId) {
  const users = await fetchGHLUsers(accessToken, locationId);
  const result = await syncToAuth(users);

  return {
    success: true,
    total: users.length,
    created: result.created,
    updated: result.updated,
  };
}
