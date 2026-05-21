import { sql } from "./db.js";
import { buildIlikePattern } from "./search-utils.js";
import { parseLookupFilters } from "./lookup-utils.js";

const USER_COLUMNS = new Set(["name", "email"]);

const USER_DISPLAY_NAME = `COALESCE(
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
)`;

const USER_COLUMN_EXPR = {
  name: USER_DISPLAY_NAME,
  email: "u.email",
};

function mapUserRow(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    email: row.email,
  };
}

export async function handleUsersLookup(body) {
  const parsed = parseLookupFilters(body, {
    allowedColumns: USER_COLUMNS,
    defaultColumn: "name",
  });

  if (parsed.mode === "autocomplete") {
    const rows = parsed.q
      ? await sql`
          SELECT
            u.id,
            ${sql.unsafe(USER_DISPLAY_NAME)} AS display_name,
            u.email
          FROM auth.users u
          WHERE ${sql.unsafe(USER_DISPLAY_NAME)} ILIKE ${`${parsed.q}%`}
          ORDER BY display_name
          LIMIT ${parsed.limit}
        `
      : await sql`
          SELECT
            u.id,
            ${sql.unsafe(USER_DISPLAY_NAME)} AS display_name,
            u.email
          FROM auth.users u
          ORDER BY display_name
          LIMIT ${parsed.limit}
        `;

    return {
      data: rows.map(mapUserRow),
      meta: {
        mode: "autocomplete",
        q: parsed.q,
        limit: parsed.limit,
        count: rows.length,
      },
    };
  }

  const columnExpr = USER_COLUMN_EXPR[parsed.search_column];
  const pattern = parsed.q
    ? buildIlikePattern(parsed.q, parsed.search_operator)
    : null;

  const rows = pattern
    ? await sql`
        SELECT
          u.id,
          ${sql.unsafe(USER_DISPLAY_NAME)} AS display_name,
          u.email
        FROM auth.users u
        WHERE ${sql.unsafe(columnExpr)} ILIKE ${pattern}
        ORDER BY display_name
        LIMIT ${parsed.limit}
      `
    : await sql`
        SELECT
          u.id,
          ${sql.unsafe(USER_DISPLAY_NAME)} AS display_name,
          u.email
        FROM auth.users u
        ORDER BY display_name
        LIMIT ${parsed.limit}
      `;

  return {
    data: rows.map(mapUserRow),
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
