import { sql } from "./db.js";

function isMissingTableError(err) {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("relation") && msg.includes("country_codes") ||
    msg.includes("relation") && msg.includes("user_profiles")
  );
}

/** Digits only for local part. */
export function normalizePhoneLocal(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits || null;
}

export function buildE164(dialCode, phoneLocal) {
  const code = String(dialCode ?? "").trim();
  const local = normalizePhoneLocal(phoneLocal);
  if (!code || !local) return null;
  const normalizedCode = code.startsWith("+") ? code : `+${code}`;
  return `${normalizedCode}${local}`;
}

function mapCountryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    iso2: row.iso2,
    dial_code: row.dial_code,
    name: row.name,
    flag_emoji: row.flag_emoji ?? null,
  };
}

export async function listActiveCountryCodes() {
  try {
    const rows = await sql`
      SELECT id, iso2, dial_code, name, flag_emoji
      FROM public.country_codes
      WHERE is_active = true
      ORDER BY sort_order ASC, name ASC
    `;
    return rows.map(mapCountryRow);
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new Error(
        "country_codes table not found. Run: supabase db push (migration 20260610120000_country_codes_user_profiles.sql)"
      );
    }
    throw err;
  }
}

export async function fetchCountryCodeById(countryCodeId) {
  const id = Number(countryCodeId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("country_code_id must be a positive integer");
  }

  const rows = await sql`
    SELECT id, iso2, dial_code, name, flag_emoji
    FROM public.country_codes
    WHERE id = ${id} AND is_active = true
    LIMIT 1
  `;

  if (!rows.length) {
    throw new Error(`country_code_id ${id} not found or inactive`);
  }

  return mapCountryRow(rows[0]);
}

async function loadCountryCodesForParse() {
  return await sql`
    SELECT id, dial_code
    FROM public.country_codes
    WHERE is_active = true
    ORDER BY length(dial_code) DESC, dial_code ASC
  `;
}

/** Parse E.164 (+923034683389) into country_code_id + phone_local. */
export async function parseE164Phone(phone) {
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

function mapProfileRow(row, country) {
  if (!row) return null;
  return {
    country_code_id: row.country_code_id ?? null,
    phone_local: row.phone_local ?? null,
    phone: row.phone ?? null,
    country_code: country ?? null,
  };
}

export async function fetchUserProfile(userId) {
  try {
    const rows = await sql`
      SELECT
        up.user_id,
        up.country_code_id,
        up.phone_local,
        up.phone,
        cc.id AS cc_id,
        cc.iso2,
        cc.dial_code,
        cc.name,
        cc.flag_emoji
      FROM public.user_profiles up
      LEFT JOIN public.country_codes cc ON cc.id = up.country_code_id
      WHERE up.user_id = ${userId}
      LIMIT 1
    `;

    if (!rows.length) return null;

    const row = rows[0];
    const country = row.cc_id
      ? {
          id: row.cc_id,
          iso2: row.iso2,
          dial_code: row.dial_code,
          name: row.name,
          flag_emoji: row.flag_emoji ?? null,
        }
      : null;

    return mapProfileRow(row, country);
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function fetchUserProfilesMap(userIds) {
  if (!userIds?.length) return new Map();

  try {
    const rows = await sql`
      SELECT
        up.user_id,
        up.country_code_id,
        up.phone_local,
        up.phone,
        cc.id AS cc_id,
        cc.iso2,
        cc.dial_code,
        cc.name,
        cc.flag_emoji
      FROM public.user_profiles up
      LEFT JOIN public.country_codes cc ON cc.id = up.country_code_id
      WHERE up.user_id IN ${sql(userIds)}
    `;

    const map = new Map();

    for (const row of rows) {
      const country = row.cc_id
        ? {
            id: row.cc_id,
            iso2: row.iso2,
            dial_code: row.dial_code,
            name: row.name,
            flag_emoji: row.flag_emoji ?? null,
          }
        : null;
      map.set(row.user_id, mapProfileRow(row, country));
    }

    return map;
  } catch (err) {
    if (isMissingTableError(err)) return new Map();
    throw err;
  }
}

export async function upsertUserProfile(userId, profile) {
  const { country_code_id, phone_local, phone } = profile;

  const hasPhone =
    (phone != null && String(phone).trim() !== "") ||
    (country_code_id != null && phone_local != null);

  try {
    if (!hasPhone) {
      await sql`
        DELETE FROM public.user_profiles
        WHERE user_id = ${userId}
      `;
      return null;
    }

    await sql`
      INSERT INTO public.user_profiles (user_id, country_code_id, phone_local, phone, updated_at)
      VALUES (
        ${userId},
        ${country_code_id ?? null},
        ${phone_local ?? null},
        ${phone ?? null},
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        country_code_id = EXCLUDED.country_code_id,
        phone_local = EXCLUDED.phone_local,
        phone = EXCLUDED.phone,
        updated_at = now()
    `;

    return fetchUserProfile(userId);
  } catch (err) {
    if (isMissingTableError(err)) {
      throw new Error(
        "user_profiles table not found. Run: supabase db push (migration 20260610120000_country_codes_user_profiles.sql)"
      );
    }
    throw err;
  }
}

/**
 * Resolve phone from request body.
 * Supports country_code_id + phone_local (preferred) or legacy phone E.164 string.
 */
export async function resolvePhoneFromBody(body, existingProfile = null) {
  const hasCountryCodeId =
    body.country_code_id !== undefined &&
    body.country_code_id !== null &&
    body.country_code_id !== "";
  const hasPhoneLocal =
    body.phone_local !== undefined && body.phone_local !== null;
  const hasLegacyPhone = body.phone !== undefined && body.phone !== null;

  if (hasCountryCodeId || hasPhoneLocal) {
    const countryCodeId = hasCountryCodeId
      ? Number(body.country_code_id)
      : existingProfile?.country_code_id;

    let phoneLocal = hasPhoneLocal
      ? normalizePhoneLocal(body.phone_local)
      : existingProfile?.phone_local ?? null;

    if (
      hasPhoneLocal &&
      body.phone_local !== null &&
      body.phone_local !== "" &&
      !phoneLocal
    ) {
      throw new Error("phone_local must contain digits");
    }

    if (body.phone_local === null || body.phone_local === "") {
      phoneLocal = null;
    }

    if (countryCodeId == null && phoneLocal == null) {
      return { country_code_id: null, phone_local: null, phone: null };
    }

    if (!countryCodeId || !phoneLocal) {
      throw new Error(
        "country_code_id and phone_local are both required when setting phone"
      );
    }

    const country = await fetchCountryCodeById(countryCodeId);
    const phone = buildE164(country.dial_code, phoneLocal);

    return {
      country_code_id: country.id,
      phone_local: phoneLocal,
      phone,
    };
  }

  if (hasLegacyPhone) {
    const raw = body.phone;
    if (raw === null || raw === "") {
      return { country_code_id: null, phone_local: null, phone: null };
    }

    const phone = String(raw).trim();
    const parsed = await parseE164Phone(phone);

    if (!parsed) {
      return { country_code_id: null, phone_local: null, phone };
    }

    return parsed;
  }

  return undefined;
}

export function mergePhoneIntoUserResponse(baseUser, profile) {
  const phone =
    profile?.phone ?? baseUser.phone ?? baseUser.user_metadata?.phone ?? null;

  return {
    ...baseUser,
    phone,
    phone_local: profile?.phone_local ?? null,
    country_code_id: profile?.country_code_id ?? null,
    country_code: profile?.country_code ?? null,
    user_metadata: {
      ...baseUser.user_metadata,
      phone,
      country_code_id: profile?.country_code_id ?? null,
      phone_local: profile?.phone_local ?? null,
    },
  };
}
