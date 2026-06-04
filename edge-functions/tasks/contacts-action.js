import { sql } from "./db.js";
import { buildIlikePattern } from "./search-utils.js";
import {
  lookupPaginationMeta,
  parseLookupFilters,
  parseLookupPage,
} from "./lookup-utils.js";

const CONTACT_COLUMNS = new Set([
  "name",
  "email",
  "phone",
  "first_name",
  "last_name",
]);

const CONTACT_COLUMN_EXPR = {
  name: "COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.email)",
  email: "c.email",
  phone: "c.phone",
  first_name: "c.first_name",
  last_name: "c.last_name",
};

const CONTACT_DISPLAY_NAME =
  "COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.email)";

function mapContactRow(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    email: row.email,
    phone: row.phone ?? null,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
  };
}

function contactWhereClause(parsed) {
  if (parsed.mode === "autocomplete") {
    if (!parsed.q) return sql``;
    return sql`WHERE ${sql.unsafe(CONTACT_DISPLAY_NAME)} ILIKE ${`${parsed.q}%`}`;
  }

  if (!parsed.q) return sql``;

  const columnExpr = CONTACT_COLUMN_EXPR[parsed.search_column];
  const pattern = buildIlikePattern(parsed.q, parsed.search_operator);
  return sql`WHERE ${sql.unsafe(columnExpr)} ILIKE ${pattern}`;
}

function contactMetaExtras(parsed) {
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

export async function handleContactsLookup(body) {
  const parsed = parseLookupFilters(body, {
    allowedColumns: CONTACT_COLUMNS,
    defaultColumn: "name",
  });
  const page = parseLookupPage(body);
  const offset = (page - 1) * parsed.limit;
  const where = contactWhereClause(parsed);

  const [countRows, rows] = await Promise.all([
    sql`
      SELECT COUNT(*)::int AS count
      FROM public.contacts c
      ${where}
    `,
    sql`
      SELECT
        c.id,
        ${sql.unsafe(CONTACT_DISPLAY_NAME)} AS display_name,
        c.email,
        c.phone,
        c.first_name,
        c.last_name
      FROM public.contacts c
      ${where}
      ORDER BY display_name
      LIMIT ${parsed.limit}
      OFFSET ${offset}
    `,
  ]);

  const count = countRows[0]?.count ?? 0;

  return {
    data: rows.map(mapContactRow),
    meta: lookupPaginationMeta({
      count,
      page,
      limit: parsed.limit,
      extra: contactMetaExtras(parsed),
    }),
  };
}
