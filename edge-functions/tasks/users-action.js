import { sql } from "./db.js";
import {
  shouldSyncGhl,
  trySyncUserCreateToGhl,
  trySyncUserDeleteToGhl,
  trySyncUserUpdateToGhl,
} from "./ghl-user-sync.js";
import {
  lookupPaginationMeta,
  parseLookupFilters,
  parseLookupPage,
} from "./lookup-utils.js";
import {
  fetchUserProfile,
  fetchUserProfilesMap,
  mergePhoneIntoUserResponse,
  resolvePhoneFromBody,
  upsertUserProfile,
} from "./user-phone-utils.js";
import { initialsFromDisplayName } from "./utils.js";

const USER_COLUMNS = new Set(["name", "email"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAuthAdminConfig() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return { url, key };
}

function parseUserId(body) {
  const id = body.id ?? body.user_id;
  if (id == null || id === "") {
    throw new Error("id is required (auth user UUID)");
  }

  const userId = String(id).trim();
  if (!UUID_RE.test(userId)) {
    throw new Error("id must be a valid auth user UUID");
  }

  return userId;
}

async function authAdminFetch(path, options = {}) {
  const { url, key } = getAuthAdminConfig();
  const hasBody = options.body !== undefined;

  const res = await fetch(`${url}/auth/v1/admin/users${path}`, {
    method: options.method ?? "GET",
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Auth admin request failed: ${err}`);
  }

  if (res.status === 204) return null;

  const text = await res.text();
  if (!text) return null;

  return JSON.parse(text);
}

async function fetchAuthUserById(userId) {
  const user = await authAdminFetch(`/${userId}`);
  if (!user?.id) {
    throw new Error(`User ${userId} not found`);
  }
  return user;
}

function authUserDisplayName(user) {
  const meta = user.user_metadata ?? {};
  const full = [meta.first_name, meta.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (full) return full;
  const email = user.email ?? "";
  return email.includes("@") ? email.split("@")[0] : email;
}

function authUserMatchesFilter(user, parsed) {
  const name = authUserDisplayName(user).toLowerCase();
  const email = (user.email ?? "").toLowerCase();

  if (parsed.mode === "autocomplete") {
    if (!parsed.q) return true;
    const q = parsed.q.toLowerCase();
    return name.startsWith(q) || email.startsWith(q);
  }

  if (!parsed.q) return true;

  const haystack = parsed.search_column === "email" ? email : name;
  const q = parsed.q.toLowerCase();

  if (parsed.search_operator === "starts_with") return haystack.startsWith(q);
  if (parsed.search_operator === "ends_with") return haystack.endsWith(q);
  if (parsed.search_operator === "equal") return haystack === q;
  return haystack.includes(q);
}

function mapAuthUser(user) {
  const meta = user.user_metadata ?? {};
  const display_name = authUserDisplayName(user);
  const first_name = meta.first_name ?? null;
  const last_name = meta.last_name ?? null;
  const phone = meta.phone ?? null;

  return {
    id: user.id,
    display_name,
    email: user.email ?? null,
    phone,
    initials: initialsFromDisplayName(display_name),
    user_metadata: {
      ghl_id: meta.ghl_id ?? null,
      first_name,
      last_name,
      phone,
      country_code_id: meta.country_code_id ?? null,
      phone_local: meta.phone_local ?? null,
    },
  };
}

function phoneMetaFields(phoneFields) {
  if (!phoneFields) return {};
  return {
    ...(phoneFields.phone ? { phone: phoneFields.phone } : {}),
    ...(phoneFields.country_code_id != null
      ? { country_code_id: phoneFields.country_code_id }
      : {}),
    ...(phoneFields.phone_local ? { phone_local: phoneFields.phone_local } : {}),
    ...(phoneFields.phone === null
      ? { phone: null, country_code_id: null, phone_local: null }
      : {}),
  };
}

async function listAuthUsers() {
  const all = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const json = await authAdminFetch(`?page=${page}&per_page=${perPage}`);
    const batch = json?.users ?? [];
    all.push(...batch);

    if (batch.length < perPage) break;
    page++;
  }

  return all;
}

function userMetaExtras(parsed) {
  if (parsed.mode === "autocomplete") {
    return { mode: "autocomplete", q: parsed.q };
  }
  return {
    mode: "search",
    q: parsed.q,
    search_column: parsed.search_column,
    search_operator: parsed.search_operator,
  };
}

function optionalString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function requiredString(value, fieldName) {
  const s = optionalString(value);
  if (!s) {
    throw new Error(`${fieldName} is required`);
  }
  return s;
}

function hasPhoneBodyFields(body) {
  return (
    body.country_code_id !== undefined ||
    body.phone_local !== undefined ||
    body.phone !== undefined
  );
}

async function buildUserResponse(user, profile = null) {
  const resolvedProfile = profile ?? (await fetchUserProfile(user.id));
  return mergePhoneIntoUserResponse(mapAuthUser(user), resolvedProfile);
}

export async function handleUserCreate(body) {
  const email = requiredString(body.email, "email");
  const password = requiredString(body.password, "password");
  const first_name = optionalString(body.first_name);
  const last_name = optionalString(body.last_name);
  const ghl_id = optionalString(body.ghl_id);

  const phoneFields = hasPhoneBodyFields(body)
    ? await resolvePhoneFromBody(body)
    : undefined;

  const payload = {
    email,
    password,
    email_confirm: true,
    user_metadata: {
      ...(first_name ? { first_name } : {}),
      ...(last_name ? { last_name } : {}),
      ...(ghl_id ? { ghl_id } : {}),
      ...phoneMetaFields(phoneFields),
    },
  };

  let created = await authAdminFetch("", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  let profile = null;
  if (phoneFields !== undefined) {
    profile = await upsertUserProfile(created.id, phoneFields);
  }

  let ghl_sync = { status: "skipped", reason: "GHL sync disabled" };

  if (shouldSyncGhl(body) && !ghl_id) {
    ghl_sync = await trySyncUserCreateToGhl(created, { password });

    if (ghl_sync.status === "completed" && ghl_sync.ghl_id) {
      const meta = created.user_metadata ?? {};
      created = await authAdminFetch(`/${created.id}`, {
        method: "PUT",
        body: JSON.stringify({
          user_metadata: {
            ...meta,
            ghl_id: ghl_sync.ghl_id,
            ...(first_name ? { first_name } : {}),
            ...(last_name ? { last_name } : {}),
            ...phoneMetaFields(phoneFields ?? {}),
          },
        }),
      });
    }
  } else if (ghl_id) {
    ghl_sync = {
      status: "skipped",
      reason: "ghl_id provided; assuming user already exists in GHL",
    };
  }

  return {
    data: await buildUserResponse(created, profile),
    ghl_sync,
  };
}

export async function handleUserUpdate(body) {
  const userId = parseUserId(body);
  const existing = await fetchAuthUserById(userId);
  const existingMeta = existing.user_metadata ?? {};
  const existingProfile = await fetchUserProfile(userId);

  const email = optionalString(body.email);
  const first_name =
    body.first_name !== undefined
      ? optionalString(body.first_name)
      : undefined;
  const last_name =
    body.last_name !== undefined ? optionalString(body.last_name) : undefined;
  const ghl_id =
    body.ghl_id !== undefined ? optionalString(body.ghl_id) : undefined;
  const password = optionalString(body.password);

  const phoneFields = hasPhoneBodyFields(body)
    ? await resolvePhoneFromBody(body, existingProfile)
    : undefined;

  const hasEmail = email !== undefined;
  const hasMeta =
    first_name !== undefined ||
    last_name !== undefined ||
    ghl_id !== undefined;
  const hasPhoneChange = phoneFields !== undefined;
  const hasPassword = password != null && password !== "";
  const ghlOnlyPassword =
    shouldSyncGhl(body) && hasPassword && !hasEmail && !hasMeta && !hasPhoneChange;

  if (!hasEmail && !hasMeta && !hasPhoneChange && !ghlOnlyPassword) {
    throw new Error(
      "Provide at least one field to update: email, first_name, last_name, country_code_id, phone_local, phone, ghl_id, or password (GHL sync only)"
    );
  }

  let updated = existing;
  let profile = existingProfile;

  if (hasEmail || hasMeta || hasPhoneChange) {
    const payload = {};

    if (hasEmail) {
      if (!email) {
        throw new Error("email cannot be empty");
      }
      payload.email = email;
    }

    if (hasMeta || hasPhoneChange) {
      payload.user_metadata = {
        ...existingMeta,
        ...(first_name !== undefined ? { first_name } : {}),
        ...(last_name !== undefined ? { last_name } : {}),
        ...(ghl_id !== undefined ? { ghl_id } : {}),
        ...(hasPhoneChange ? phoneMetaFields(phoneFields) : {}),
      };
    }

    updated = await authAdminFetch(`/${userId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  if (hasPhoneChange) {
    profile = await upsertUserProfile(userId, phoneFields);
  }

  let ghl_sync = { status: "skipped", reason: "GHL sync disabled" };

  if (shouldSyncGhl(body)) {
    ghl_sync = await trySyncUserUpdateToGhl(updated, {
      password: hasPassword ? password : undefined,
    });
  }

  return {
    data: await buildUserResponse(updated, profile),
    ghl_sync,
  };
}

export async function handleUserDelete(body) {
  const userId = parseUserId(body);
  const existing = await fetchAuthUserById(userId);

  const unassign =
    body.unassign_tasks !== false && body.unassign_tasks !== "false";

  let tasksUnassigned = 0;

  if (unassign) {
    const rows = await sql`
      UPDATE public.tasks
      SET assigned_to = NULL
      WHERE assigned_to = ${userId}
      RETURNING id
    `;
    tasksUnassigned = rows.length;
  } else {
    const rows = await sql`
      SELECT COUNT(*)::int AS count
      FROM public.tasks
      WHERE assigned_to = ${userId}
    `;
    const assignedCount = rows[0]?.count ?? 0;
    if (assignedCount > 0) {
      throw new Error(
        `User is assigned to ${assignedCount} task(s). Set unassign_tasks: true or remove assignments first.`
      );
    }
  }

  let ghl_sync = { status: "skipped", reason: "GHL sync disabled" };

  if (shouldSyncGhl(body)) {
    ghl_sync = await trySyncUserDeleteToGhl(existing);
  }

  await authAdminFetch(`/${userId}`, { method: "DELETE" });

  return {
    data: {
      id: userId,
      deleted: true,
      tasks_unassigned: tasksUnassigned,
    },
    ghl_sync,
  };
}

export async function handleUsersLookup(body) {
  const parsed = parseLookupFilters(body, {
    allowedColumns: USER_COLUMNS,
    defaultColumn: "name",
  });
  const page = parseLookupPage(body);

  const filtered = (await listAuthUsers())
    .filter((u) => authUserMatchesFilter(u, parsed))
    .sort((a, b) =>
      authUserDisplayName(a).localeCompare(authUserDisplayName(b), undefined, {
        sensitivity: "base",
      })
    );

  const count = filtered.length;
  const offset = (page - 1) * parsed.limit;
  const pageRows = filtered.slice(offset, offset + parsed.limit);
  const profilesMap = await fetchUserProfilesMap(pageRows.map((u) => u.id));

  return {
    data: pageRows.map((u) =>
      mergePhoneIntoUserResponse(mapAuthUser(u), profilesMap.get(u.id))
    ),
    meta: lookupPaginationMeta({
      count,
      page,
      limit: parsed.limit,
      extra: {
        ...userMetaExtras(parsed),
        returned: pageRows.length,
      },
    }),
  };
}
