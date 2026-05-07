import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// -------------------------
// GET VAULT
// -------------------------
async function getVault() {
  const { data, error } = await supabase.rpc("get_vault_secrets", {
    names: [],
  });

  if (error) throw new Error(error.message);

  return data || {};
}

// -------------------------
// GET ACCESS TOKEN
// -------------------------
async function getAccessToken() {
  const { data, error } = await supabase.rpc("get_token_health");

  if (error) throw new Error(error.message);
  if (!data?.access_token) throw new Error("No access token found");

  console.log("TOKEN FETCHED");

  return data.access_token;
}

// -------------------------
// FETCH GHL USERS
// -------------------------
async function fetchGHLUsers(accessToken: string, locationId: string) {
  const res = await fetch(
    `https://services.leadconnectorhq.com/users/?locationId=${locationId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error("GHL ERROR:", data);
    throw new Error(data?.message || "Failed to fetch users");
  }

  console.log("GHL USERS COUNT:", data?.users?.length || 0);

  return data.users || [];
}

// -------------------------
// SYNC USERS TO AUTH (FIXED)
// -------------------------
async function syncToAuth(users: any[]) {
  let created = 0;
  let updated = 0;

  // ⚠️ FIX: correct API usage
  const { data: usersData, error } =
    await supabase.auth.admin.listUsers();

  if (error) throw new Error(error.message);

  const existingUsers = usersData.users;

  for (const user of users) {
    if (!user.email) continue;

    console.log("PROCESSING:", user.email);

    // find existing user by email
    const existing = existingUsers.find(
      (u) => u.email === user.email
    );

    if (!existing) {
      const { error } = await supabase.auth.admin.createUser({
        email: user.email,
        email_confirm: true,
        user_metadata: {
          ghl_id: user.id,
          first_name: user.firstName || null,
          last_name: user.lastName || null,
        },
      });

      if (error) {
        console.error("CREATE ERROR:", user.email, error.message);
        continue;
      }

      created++;
      console.log("CREATED:", user.email);
    } else {
      const { error } = await supabase.auth.admin.updateUserById(
        existing.id,
        {
          user_metadata: {
            ghl_id: user.id,
            first_name: user.firstName || null,
            last_name: user.lastName || null,
          },
        }
      );

      if (error) {
        console.error("UPDATE ERROR:", user.email, error.message);
        continue;
      }

      updated++;
      console.log("UPDATED:", user.email);
    }
  }

  return { created, updated };
}

// -------------------------
// EDGE FUNCTION ENTRY
// -------------------------
serve(async () => {
  try {
    console.log("SYNC START");

    // 1. vault
    const vault = await getVault();

    const locationId = vault.locationId || vault.location_id;

    if (!locationId) {
      throw new Error("Missing locationId in vault");
    }

    console.log("LOCATION ID:", locationId);

    // 2. token
    const accessToken = await getAccessToken();

    // 3. GHL users
    const users = await fetchGHLUsers(accessToken, locationId);

    // 4. sync auth
    const result = await syncToAuth(users);

    console.log("SYNC COMPLETE:", result);

    return Response.json({
      success: true,
      total: users.length,
      created: result.created,
      updated: result.updated,
    });
  } catch (e: any) {
    console.error("FATAL ERROR:", e);

    return Response.json(
      {
        success: false,
        error: e.message,
      },
      { status: 500 }
    );
  }
});