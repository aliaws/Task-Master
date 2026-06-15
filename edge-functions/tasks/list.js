import { sql } from "./db.js";
import {
  buildAssignee,
  buildContact,
  buildStatus,
  buildTimeSpent,
  truncateDescription,
  paginationMeta,
  parseDescriptionTruncateLength,
  parsePagination,
  parseSort,
} from "./utils.js";
import {
  buildListWhere,
  buildOrderClause,
  getCompletedStatusId,
  needsCompletedStatusId,
  parseListFilters,
  TASK_FROM_JOINS,
  TASK_SELECT_CORE,
} from "./query.js";

function mapListRow(row, descriptionTruncateLength) {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    status: buildStatus(row),
    description: row.description,
    description_truncated: truncateDescription(
      row.description,
      descriptionTruncateLength
    ),
    contact: buildContact(row),
    assigned_to: buildAssignee(row),
    due_date: row.due_date,
    task_order: Number(row.task_order ?? 0),
    ghl_id: row.ghl_id,
    data_source: row.data_source ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...buildTimeSpent(row),
  };
}

export async function handleList(body) {
  const { page, limit, offset } = parsePagination(body);
  const { sortBy, order, column } = parseSort(body);
  const descriptionTruncateLength = parseDescriptionTruncateLength(body);
  const filters = parseListFilters(body);
  const orderClause = buildOrderClause(column, order);

  const completedStatusId = needsCompletedStatusId(filters)
    ? await getCompletedStatusId()
    : null;
  const whereExtra = buildListWhere(filters, completedStatusId);

  const countRows = await sql`
    SELECT COUNT(*)::int AS count
    FROM public.tasks tb
    WHERE 1 = 1
    ${whereExtra}
  `;

  const count = countRows[0]?.count ?? 0;

  const rows = await sql`
    SELECT ${TASK_SELECT_CORE}
    ${TASK_FROM_JOINS}
    WHERE 1 = 1
    ${whereExtra}
    ${orderClause}
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return {
    data: rows.map((row) => mapListRow(row, descriptionTruncateLength)),
    meta: {
      ...paginationMeta({ count, page, limit, sortBy, order }),
      description_truncate_length: descriptionTruncateLength,
    },
  };
}
