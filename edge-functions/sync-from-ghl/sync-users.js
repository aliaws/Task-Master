import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

export async function syncUser(sql, ghlUserId) {
  console.log("[sync-users] triggered with ghlUserId:", ghlUserId);

  if (!ghlUserId) {
    console.log("[sync-users] no ghlUserId provided, skipping");
    return null;
  }

  const rows = await sql`
    SELECT id FROM auth.users
    WHERE raw_user_meta_data->>'ghl_id' = ${ghlUserId}
    LIMIT 1
  `;

  if (rows.length > 0) {
    console.log("[sync-users] found user:", rows[0].id, "for GHL user ID:", ghlUserId);
    return rows[0].id;
  }

  console.warn("[sync-users] no Supabase user found for GHL user ID:", ghlUserId);
  return null;
}

export async function handleUserCreate(sql, payload) {
  console.log("[sync-users] UserCreate handler called");
  console.log("[sync-users] GHL user ID:", payload.id);

  const existing = await sql`
    SELECT id, email, raw_user_meta_data FROM auth.users
    WHERE raw_user_meta_data->>'ghl_id' = ${payload.id}
    LIMIT 1
  `;

  if (existing.length > 0) {
    console.log("[sync-users] user already exists, updating metadata:", existing[0].id);
    return handleUserUpdate(sql, payload);
  }

  const fullName = [payload.firstName, payload.lastName].filter(Boolean).join(" ");

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: payload.email,
    phone: payload.phone || undefined,
    email_confirm: true,
    user_metadata: {
      ghl_id: payload.id,
      first_name: payload.firstName,
      last_name: payload.lastName,
      full_name: fullName,
      email: payload.email,
      phone: payload.phone,
      role: payload.role,
    },
  });

  if (error) {
    console.error("[sync-users] failed to create user:", error);
    return { action: "created", error: error.message, ghl_id: payload.id };
  }

  console.log("[sync-users] user created:", data.user.id);
  return { action: "created", user_id: data.user.id };
}

export async function handleUserUpdate(sql, payload) {
  console.log("[sync-users] UserUpdate handler called");
  console.log("[sync-users] GHL user ID:", payload.id);

  const rows = await sql`
    SELECT id, email, raw_user_meta_data FROM auth.users
    WHERE raw_user_meta_data->>'ghl_id' = ${payload.id}
    LIMIT 1
  `;

  if (rows.length === 0) {
    console.warn("[sync-users] no Supabase user found for GHL user ID:", payload.id);
    return { action: "updated", warning: "User not found", ghl_id: payload.id };
  }

  const existing = rows[0];
  console.log("[sync-users] found user:", existing.id, "current email:", existing.email);

  const fullName = [payload.firstName, payload.lastName].filter(Boolean).join(" ");

  const updatedMeta = {
    ...(existing.raw_user_meta_data || {}),
    ghl_id: payload.id,
    first_name: payload.firstName,
    last_name: payload.lastName,
    full_name: fullName || existing.raw_user_meta_data?.full_name,
    email: payload.email,
    role: payload.role,
  };

  await sql`
    UPDATE auth.users SET
      email = ${payload.email || existing.email},
      raw_user_meta_data = ${sql.json(updatedMeta)}
    WHERE id = ${existing.id}
  `;

  console.log("[sync-users] user updated:", existing.id);
  return { action: "updated", user_id: existing.id };
}

export async function handleUserDelete(sql, ghlId) {
  console.log("[sync-users] UserDelete handler called");
  console.log("[sync-users] GHL user ID:", ghlId);

  const rows = await sql`
    SELECT id FROM auth.users
    WHERE raw_user_meta_data->>'ghl_id' = ${ghlId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    console.warn("[sync-users] no Supabase user found for GHL user ID:", ghlId);
    return { action: "deleted", warning: "User not found", ghl_id: ghlId };
  }

  const userId = rows[0].id;
  console.log("[sync-users] deleting user:", userId);

  await sql`DELETE FROM auth.users WHERE id = ${userId}`;

  console.log("[sync-users] user deleted:", userId);
  return { action: "deleted", user_id: userId };
}
