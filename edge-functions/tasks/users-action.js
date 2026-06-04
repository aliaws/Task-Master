import { sql } from "./db.js";
import { buildIlikePattern } from "./search-utils.js";
import {
  lookupPaginationMeta,
  parseLookupFilters,
  parseLookupPage,
} from "./lookup-utils.js";

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

function userWhereClause(parsed) {
  if (parsed.mode === "autocomplete") {
    if (!parsed.q) return sql``;
    return sql`WHERE ${sql.unsafe(USER_DISPLAY_NAME)} ILIKE ${`${parsed.q}%`}`;
  }

  if (!parsed.q) return sql``;

  const columnExpr = USER_COLUMN_EXPR[parsed.search_column];
  const pattern = buildIlikePattern(parsed.q, parsed.search_operator);
  return sql`WHERE ${sql.unsafe(columnExpr)} ILIKE ${pattern}`;
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
  const offset = (page - 1) * parsed.limit;
  const where = userWhereClause(parsed);

  const [countRows, rows] = await Promise.all([
    sql`
      SELECT COUNT(*)::int AS count
      FROM auth.users u
      ${where}
    `,
    sql`
      SELECT
        u.id,
        ${sql.unsafe(USER_DISPLAY_NAME)} AS display_name,
        u.email
      FROM auth.users u
      ${where}
      ORDER BY display_name
      LIMIT ${parsed.limit}
      OFFSET ${offset}
    `,
  ]);

  const count = countRows[0]?.count ?? 0;

  return {
    data: rows.map(mapUserRow),
    meta: lookupPaginationMeta({
      count,
      page,
      limit: parsed.limit,
      extra: userMetaExtras(parsed),
    }),
  };
}
