import { sql } from "./db.js";

let completedStatusIdCache = null;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getCompletedStatusId() {
  if (completedStatusIdCache) return completedStatusIdCache;

  const rows = await sql`
    SELECT id FROM public.task_boards
    WHERE is_completed = true
    LIMIT 1
  `;

  completedStatusIdCache = rows[0]?.id ?? null;
  return completedStatusIdCache;
}

function asArray(values) {
  if (values == null) return null;
  return Array.isArray(values) ? values : [values];
}

function toIntArray(values, label) {
  const input = asArray(values);
  if (!input || input.length === 0) return null;

  const ids = input.map((v) => Number(v)).filter((n) => Number.isInteger(n));

  if (ids.length === 0) {
    throw new Error(
      `${label} must be an integer or array of integers (e.g. task_boards.id from action "boards").`
    );
  }

  if (ids.length !== input.length) {
    throw new Error(`${label} contains non-integer value(s).`);
  }

  return ids;
}

function toUuidArray(values, label) {
  const input = asArray(values);
  if (!input || input.length === 0) return null;

  const ids = input.map(String).filter((id) => UUID_RE.test(id));

  if (ids.length === 0) {
    throw new Error(
      `${label} must contain valid contact UUIDs (contacts.id only).`
    );
  }

  if (ids.length !== input.length) {
    throw new Error(`${label} contains invalid UUID(s).`);
  }

  return ids;
}

const TITLE_MATCH_MODES = new Set([
  "starts_with",
  "contains",
  "ends_with",
]);

function normalizeTitleMatch(mode) {
  if (mode == null || mode === "") return "contains";

  const key = String(mode).trim().toLowerCase().replace(/-/g, "_");
  const aliases = {
    startswith: "starts_with",
    endswith: "ends_with",
  };

  const normalized = aliases[key] ?? key;
  if (!TITLE_MATCH_MODES.has(normalized)) {
    throw new Error(
      'filters.title_match must be "starts_with", "contains", or "ends_with".'
    );
  }
  return normalized;
}

function escapeLikePattern(value) {
  return String(value).replace(/[%_\\]/g, "\\$&");
}

function parsePriority(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  return s || null;
}

function parseTitleSearch(raw) {
  const title =
    raw.title != null && String(raw.title).trim() !== ""
      ? String(raw.title).trim()
      : null;
  if (!title) return null;

  return {
    title,
    match: normalizeTitleMatch(raw.title_match),
  };
}

/** assign_to may be auth user UUID (column type uuid, not tasks PK). */
function toAssignArray(values) {
  const input = asArray(values);
  if (!input || input.length === 0) return null;

  const uuids = input.map(String).filter((id) => UUID_RE.test(id));
  if (uuids.length === input.length) return uuids;

  const ints = input.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  if (ints.length === input.length) return ints;

  throw new Error(
    "filters.assign must be auth user UUIDs or integer ids, depending on your assigned_to column."
  );
}

/** Joins SQL fragments with AND; use after `WHERE 1 = 1`. */
function combineAnd(parts) {
  if (!parts.length) return sql``;

  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    result = sql`${result} AND ${parts[i]}`;
  }
  return sql` AND ${result}`;
}

export function parseListFilters(body) {
  const raw = body.filters && typeof body.filters === "object" ? body.filters : {};

  return {
    status: toIntArray(raw.status, "filters.status"),
    assign: toAssignArray(raw.assign),
    contacts: toUuidArray(raw.contacts, "filters.contacts"),
    priority: parsePriority(raw.priority),
    titleSearch: parseTitleSearch(raw),
    due: raw.due ?? null,
    completed:
      raw.completed === true || raw.completed === false ? raw.completed : null,
  };
}

/** True when list filters need the completed board id from the database. */
export function needsCompletedStatusId(filters) {
  return (
    filters.completed === true ||
    filters.completed === false ||
    filters.due === "overdue"
  );
}

export function buildListWhere(filters, completedStatusId) {
  const parts = [];

  if (filters.status?.length) {
    parts.push(sql`tb.status_id IN ${sql(filters.status)}`);
  }

  if (filters.priority) {
    parts.push(sql`tb.priority = ${filters.priority}`);
  }

  if (filters.assign?.length) {
    parts.push(sql`tb.assigned_to IN ${sql(filters.assign)}`);
  }

  if (filters.contacts?.length) {
    parts.push(sql`tb.contact_id IN ${sql(filters.contacts)}`);
  }

  if (filters.titleSearch) {
    const escaped = escapeLikePattern(filters.titleSearch.title);
    const pattern =
      filters.titleSearch.match === "starts_with"
        ? `${escaped}%`
        : filters.titleSearch.match === "ends_with"
          ? `%${escaped}`
          : `%${escaped}%`;
    parts.push(sql`tb.title ILIKE ${pattern}`);
  }

  if (filters.completed === true && completedStatusId != null) {
    parts.push(sql`tb.status_id = ${completedStatusId}`);
  } else if (filters.completed === false && completedStatusId != null) {
    parts.push(sql`tb.status_id <> ${completedStatusId}`);
  }

  const due = filters.due;
  if (due === "today") {
    parts.push(sql`tb.due_date IS NOT NULL`);
    parts.push(
      sql`(tb.due_date AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date`
    );
  } else if (due === "overdue") {
    parts.push(sql`tb.due_date IS NOT NULL`);
    parts.push(sql`tb.due_date < NOW()`);
    if (completedStatusId != null) {
      parts.push(sql`tb.status_id <> ${completedStatusId}`);
    }
  } else if (due === "coming") {
    parts.push(sql`tb.due_date IS NOT NULL`);
    parts.push(sql`tb.due_date > NOW()`);
  }

  return combineAnd(parts);
}

export function buildOrderClause(sortColumn, order) {
  const dir = order === "ASC" ? sql`ASC` : sql`DESC`;
  return sql`ORDER BY ${sql.unsafe(sortColumn)} ${dir}`;
}

export const TASK_FROM_JOINS = sql`
  FROM public.tasks tb
  LEFT JOIN public.task_boards b ON b.id = tb.status_id
  LEFT JOIN public.contacts c ON c.id = tb.contact_id
  LEFT JOIN auth.users u ON u.id = tb.assigned_to
`;

export const TASK_SELECT_CORE = sql`
  tb.id,
  tb.title,
  tb.priority,
  tb.description,
  tb.due_date,
  tb.ghl_id,
  tb.created_at,
  tb.updated_at,
  tb.status_id,
  b.name AS status_name,
  c.id AS contact_id,
  COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
    c.email
  ) AS contact_name,
  c.email AS contact_email,
  u.id AS assigned_id,
  COALESCE(
    NULLIF(
      TRIM(
        CONCAT_WS(
          ' ',
          u.raw_user_meta_data->>'first_name',
          u.raw_user_meta_data->>'last_name'
        )
      ),
      ''
    ),
    split_part(u.email, '@', 1)
  ) AS assignee_display_name,
  COALESCE(
    (
      SELECT SUM(ts.duration_seconds)
      FROM public.task_sessions ts
      WHERE ts.task_id = tb.id
    ),
    0
  )::double precision AS time_spent
`;
