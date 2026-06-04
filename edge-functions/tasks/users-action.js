import {
  lookupPaginationMeta,
  parseLookupFilters,
  parseLookupPage,
} from "./lookup-utils.js";
import { initialsFromDisplayName } from "./utils.js";

const USER_COLUMNS = new Set(["name", "email"]);

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
  return haystack.includes(q);
}

function mapAuthUser(user) {
  const meta = user.user_metadata ?? {};
  const display_name = authUserDisplayName(user);
  const first_name = meta.first_name ?? null;
  const last_name = meta.last_name ?? null;

  return {
    id: user.id,
    display_name,
    email: user.email ?? null,
    initials: initialsFromDisplayName(display_name),
    user_metadata: {
      ghl_id: meta.ghl_id ?? null,
      first_name,
      last_name,
    },
  };
}

async function listAuthUsers() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const all = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const res = await fetch(
      `${url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
        },
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Auth admin listUsers failed: ${err}`);
    }

    const json = await res.json();
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

  return {
    data: pageRows.map(mapAuthUser),
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
