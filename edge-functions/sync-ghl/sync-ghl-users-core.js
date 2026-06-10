import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GHL_API_VERSION, GHL_BASE_URL } from "./sync-constants.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

function normalizePhoneLocal(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits || null;
}

async function loadCountryCodesForParse() {
  const { data, error } = await supabase
    .from("country_codes")
    .select("id, dial_code")
    .eq("is_active", true);

  if (error) throw error;

  return (data ?? []).sort(
    (a, b) => String(b.dial_code).length - String(a.dial_code).length
  );
}

async function parseGhlPhone(phone) {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;

  const normalized = raw.startsWith("+") ? raw : `+${raw.replace(/\D/g, "")}`;
  if (normalized.length < 4) return null;

  const codes = await loadCountryCodesForParse();

  for (const row of codes) {
    const dial = String(row.dial_code);
    if (normalized.startsWith(dial)) {
      const local = normalizePhoneLocal(normalized.slice(dial.length));
      if (!local) return null;
      return {
        country_code_id: row.id,
        phone_local: local,
        phone: `${dial}${local}`,
      };
    }
  }

  return {
    country_code_id: null,
    phone_local: null,
    phone: normalized,
  };
}

async function upsertUserProfile(userId, phone) {
  const parsed = await parseGhlPhone(phone);

  if (!parsed?.phone) {
    await supabase.from("user_profiles").delete().eq("user_id", userId);
    return;
  }

  const { error } = await supabase.from("user_profiles").upsert(
    {
      user_id: userId,
      country_code_id: parsed.country_code_id,
      phone_local: parsed.phone_local,
      phone: parsed.phone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("USER PROFILE UPSERT ERROR:", userId, error.message);
  }
}

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
    const phone = user.phone || null;
    const parsedPhone = phone ? await parseGhlPhone(phone) : null;

    const userMetadata = {
      ghl_id: user.id,
      first_name: user.firstName || null,
      last_name: user.lastName || null,
      phone,
      ...(parsedPhone?.country_code_id != null
        ? { country_code_id: parsedPhone.country_code_id }
        : {}),
      ...(parsedPhone?.phone_local ? { phone_local: parsedPhone.phone_local } : {}),
    };

    if (!existing) {
      const { data: createdUser, error: createError } =
        await supabase.auth.admin.createUser({
          email: user.email,
          email_confirm: true,
          user_metadata: userMetadata,
        });

      if (createError) {
        console.error("CREATE ERROR:", user.email, createError.message);
        continue;
      }

      if (createdUser?.user?.id) {
        await upsertUserProfile(createdUser.user.id, phone);
      }

      created++;
    } else {
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        existing.id,
        { user_metadata: userMetadata }
      );

      if (updateError) {
        console.error("UPDATE ERROR:", user.email, updateError.message);
        continue;
      }

      await upsertUserProfile(existing.id, phone);
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
