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

function toIntArray(values, label) {
  if (!Array.isArray(values) || values.length === 0) return null;

  const ids = values.map((v) => Number(v)).filter((n) => Number.isInteger(n));

  if (ids.length === 0) {
    throw new Error(
      `${label} must be an array of integers (e.g. task_boards.id from action "boards").`
    );
  }

  if (ids.length !== values.length) {
    throw new Error(`${label} contains non-integer value(s).`);
  }

  return ids;
}

function toUuidArray(values, label) {
  if (!Array.isArray(values) || values.length === 0) return null;

  const ids = values.map(String).filter((id) => UUID_RE.test(id));

  if (ids.length === 0) {
    throw new Error(
      `${label} must contain valid contact UUIDs (contacts.id only).`
    );
  }

  if (ids.length !== values.length) {
    throw new Error(`${label} contains invalid UUID(s).`);
  }

  return ids;
}

/** assign_to may be auth user UUID (column type uuid, not tasks PK). */
function toAssignArray(values) {
  if (!Array.isArray(values) || values.length === 0) return null;

  const uuids = values.map(String).filter((id) => UUID_RE.test(id));
  if (uuids.length === values.length) return uuids;

  const ints = values.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  if (ints.length === values.length) return ints;

  throw new Error(
    "filters.assign must be auth user UUIDs or integer ids, depending on your assigned_to column."
  );
}

function combineAnd(parts) {
  if (!parts.length) return sql``;

  return parts.reduce(
    (acc, part, i) => (i === 0 ? sql`AND ${part}` : sql`${acc} AND ${part}`)
  );
}

export function parseListFilters(body) {
  const raw = body.filters && typeof body.filters === "object" ? body.filters : {};

  return {
    status: toIntArray(raw.status, "filters.status"),
    assign: toAssignArray(raw.assign),
    contacts: toUuidArray(raw.contacts, "filters.contacts"),
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

  if (filters.assign?.length) {
    parts.push(sql`tb.assigned_to IN ${sql(filters.assign)}`);
  }

  if (filters.contacts?.length) {
    parts.push(sql`tb.contact_id IN ${sql(filters.contacts)}`);
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
  ) AS assignee_display_name
`;
