import { sql } from "./db.js";
import { buildIlikePattern } from "./search-utils.js";
import { parseLookupFilters } from "./lookup-utils.js";

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

export async function handleContactsLookup(body) {
  const parsed = parseLookupFilters(body, {
    allowedColumns: CONTACT_COLUMNS,
    defaultColumn: "name",
  });

  if (parsed.mode === "autocomplete") {
    const rows = parsed.q
      ? await sql`
          SELECT
            c.id,
            ${sql.unsafe(CONTACT_DISPLAY_NAME)} AS display_name,
            c.email,
            c.phone,
            c.first_name,
            c.last_name
          FROM public.contacts c
          WHERE ${sql.unsafe(CONTACT_DISPLAY_NAME)} ILIKE ${`${parsed.q}%`}
          ORDER BY display_name
          LIMIT ${parsed.limit}
        `
      : await sql`
          SELECT
            c.id,
            ${sql.unsafe(CONTACT_DISPLAY_NAME)} AS display_name,
            c.email,
            c.phone,
            c.first_name,
            c.last_name
          FROM public.contacts c
          ORDER BY display_name
          LIMIT ${parsed.limit}
        `;

    return {
      data: rows.map(mapContactRow),
      meta: {
        mode: "autocomplete",
        q: parsed.q,
        limit: parsed.limit,
        count: rows.length,
      },
    };
  }

  const columnExpr = CONTACT_COLUMN_EXPR[parsed.search_column];
  const pattern = parsed.q
    ? buildIlikePattern(parsed.q, parsed.search_operator)
    : null;

  const rows = pattern
    ? await sql`
        SELECT
          c.id,
          ${sql.unsafe(CONTACT_DISPLAY_NAME)} AS display_name,
          c.email,
          c.phone,
          c.first_name,
          c.last_name
        FROM public.contacts c
        WHERE ${sql.unsafe(columnExpr)} ILIKE ${pattern}
        ORDER BY display_name
        LIMIT ${parsed.limit}
      `
    : await sql`
        SELECT
          c.id,
          ${sql.unsafe(CONTACT_DISPLAY_NAME)} AS display_name,
          c.email,
          c.phone,
          c.first_name,
          c.last_name
        FROM public.contacts c
        ORDER BY display_name
        LIMIT ${parsed.limit}
      `;

  return {
    data: rows.map(mapContactRow),
    meta: {
      mode: "search",
      q: parsed.q,
      search_column: parsed.search_column,
      search_operator: parsed.search_operator,
      limit: parsed.limit,
      count: rows.length,
    },
  };
}
