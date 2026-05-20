import { sql } from "./db.js";
import {
  buildAssignee,
  buildContact,
  buildStatus,
  formatHMS,
  paginationMeta,
  parsePagination,
  parseSort,
} from "./utils.js";
import {
  buildListWhere,
  buildOrderClause,
  parseListFilters,
  TASK_FROM_JOINS,
  TASK_SELECT_CORE,
} from "./query.js";

function mapListRow(row) {
  const timeSpent = Number(row.time_spent);

  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    status: buildStatus(row),
    description: row.description,
    contact: buildContact(row),
    assigned_to: buildAssignee(row),
    due_date: row.due_date,
    ghl_id: row.ghl_id,
    time_spent: timeSpent,
    time_spent_in_words: formatHMS(timeSpent),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleList(body) {
  const { page, limit, offset } = parsePagination(body);
  const { sortBy, order, column } = parseSort(body);
  const filters = parseListFilters(body);
  const whereExtra = await buildListWhere(filters);
  const orderClause = buildOrderClause(column, order);

  const countRows = await sql`
    SELECT COUNT(DISTINCT tb.id)::int AS count
    ${TASK_FROM_JOINS}
    WHERE 1 = 1
    ${whereExtra}
  `;

  const count = countRows[0]?.count ?? 0;

  const rows = await sql`
    SELECT ${TASK_SELECT_CORE}
    ${TASK_FROM_JOINS}
    WHERE 1 = 1
    ${whereExtra}
    GROUP BY
      tb.id,
      b.id,
      b.name,
      c.id,
      c.first_name,
      c.last_name,
      c.email,
      u.id,
      u.email,
      u.raw_user_meta_data
    ${orderClause}
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return {
    data: rows.map(mapListRow),
    meta: paginationMeta({ count, page, limit, sortBy, order }),
  };
}
