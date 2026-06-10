import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

function vaultKey(secrets, ...keys) {
  for (const key of keys) {
    const value = secrets?.[key];
    if (value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

async function getGhlContext() {
  const { data: token, error: tokenErr } = await supabase.rpc("get_token_health");
  if (tokenErr) throw new Error(tokenErr.message);
  if (!token?.access_token) throw new Error("No GHL access token");

  const { data: secrets, error: vaultErr } = await supabase.rpc("get_vault_secrets", {
    names: [],
  });
  if (vaultErr) throw new Error(vaultErr.message);

  const locationId = vaultKey(secrets, "locationId", "location_id");
  if (!locationId) throw new Error("Missing locationId in vault");

  return {
    accessToken: token.access_token,
    locationId,
    secrets: secrets ?? {},
  };
}

async function ghlFetch(path, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Version", GHL_API_VERSION);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${GHL_BASE_URL}${path}`, { ...init, headers });
}

async function ghlJsonOrThrow(res, context) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`${context} (${res.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

function extractGhlUserId(data) {
  if (data?.id) return String(data.id);
  if (data?.user?.id) return String(data.user.id);
  return null;
}

async function resolveCompanyId(accessToken, locationId, secrets) {
  const fromVault = vaultKey(secrets, "companyId", "company_id");
  if (fromVault) return fromVault;

  const res = await ghlFetch(`/locations/${locationId}`, accessToken);
  const data = await ghlJsonOrThrow(res, "GHL get location");
  const location = data.location ?? data;
  const companyId =
    location?.companyId ??
    location?.company_id ??
    data.companyId ??
    data.company_id;

  if (!companyId) {
    throw new Error(
      "Missing companyId in vault and could not resolve from GHL location"
    );
  }

  return String(companyId);
}

function userFieldsFromAuth(user) {
  const meta = user.user_metadata ?? {};
  const phone = meta.phone ? String(meta.phone).trim() : "";
  return {
    firstName: meta.first_name ? String(meta.first_name) : "",
    lastName: meta.last_name ? String(meta.last_name) : "",
    email: user.email ? String(user.email) : "",
    phone: phone || null,
    ghlId: meta.ghl_id ? String(meta.ghl_id) : null,
    userId: user.id ? String(user.id) : null,
  };
}

async function resolvePhoneForGhl(user) {
  const { phone, userId } = userFieldsFromAuth(user);
  if (phone) return phone;

  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_profiles")
    .select("phone")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  const profilePhone = data?.phone ? String(data.phone).trim() : "";
  return profilePhone || null;
}

function withGhlPhone(payload, phone) {
  if (phone) payload.phone = phone;
  return payload;
}

export function shouldSyncGhl(body) {
  return body?.sync_ghl !== false && body?.sync_ghl !== "false";
}

export async function trySyncUserCreateToGhl(user, { password }) {
  try {
    const { accessToken, locationId, secrets } = await getGhlContext();
    const companyId = await resolveCompanyId(accessToken, locationId, secrets);
    const { firstName, lastName, email } = userFieldsFromAuth(user);
    const phone = await resolvePhoneForGhl(user);

    if (!email) throw new Error("User email is required for GHL create");

    const payload = withGhlPhone(
      {
        companyId,
        locationIds: [locationId],
        firstName,
        lastName,
        email,
        password,
        type: Deno.env.get("GHL_USER_TYPE") ?? "account",
        role: Deno.env.get("GHL_USER_ROLE") ?? "user",
      },
      phone
    );

    const res = await ghlFetch("/users/", accessToken, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const data = await ghlJsonOrThrow(res, "GHL create user");
    const ghlId = extractGhlUserId(data);

    if (!ghlId) throw new Error("GHL create user response missing id");

    return {
      status: "completed",
      action: "created",
      ghl_id: ghlId,
      ghl_method: "POST",
      ghl_path: "/users/",
    };
  } catch (err) {
    return {
      status: "failed",
      error: err?.message ?? String(err),
    };
  }
}

export async function trySyncUserUpdateToGhl(user, { password } = {}) {
  try {
    const { ghlId, firstName, lastName, email } = userFieldsFromAuth(user);
    const phone = await resolvePhoneForGhl(user);

    if (!ghlId) {
      return {
        status: "skipped",
        reason: "User has no ghl_id; create in GHL first or run sync-ghl?sync=users",
      };
    }

    const { accessToken, locationId, secrets } = await getGhlContext();
    const companyId = await resolveCompanyId(accessToken, locationId, secrets);

    const payload = withGhlPhone(
      {
        companyId,
        locationIds: [locationId],
        firstName,
        lastName,
        email,
        type: Deno.env.get("GHL_USER_TYPE") ?? "account",
        role: Deno.env.get("GHL_USER_ROLE") ?? "user",
      },
      phone
    );

    if (password) payload.password = password;

    const path = `/users/${ghlId}`;
    const res = await ghlFetch(path, accessToken, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    await ghlJsonOrThrow(res, "GHL update user");

    return {
      status: "completed",
      action: "updated",
      ghl_id: ghlId,
      ghl_method: "PUT",
      ghl_path: path,
    };
  } catch (err) {
    return {
      status: "failed",
      error: err?.message ?? String(err),
    };
  }
}

export async function trySyncUserDeleteToGhl(user) {
  try {
    const { ghlId } = userFieldsFromAuth(user);

    if (!ghlId) {
      return {
        status: "skipped",
        reason: "User has no ghl_id in GHL",
      };
    }

    const { accessToken } = await getGhlContext();
    const path = `/users/${ghlId}`;
    const res = await ghlFetch(path, accessToken, { method: "DELETE" });

    await ghlJsonOrThrow(res, "GHL delete user");

    return {
      status: "completed",
      action: "deleted",
      ghl_id: ghlId,
      ghl_method: "DELETE",
      ghl_path: path,
    };
  } catch (err) {
    return {
      status: "failed",
      error: err?.message ?? String(err),
    };
  }
}
