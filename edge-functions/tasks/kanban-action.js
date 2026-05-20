import { sql } from "./db.js";
import { formatHMS } from "./utils.js";

/**
 * Original kanban board API — unchanged behaviour.
 */
const buildFilters = (filters) => {
  if (!filters) return sql``;

  const entries = Object.entries(filters).filter(
    ([, val]) =>
      val?.value !== undefined &&
      val?.value !== null &&
      val.value !== ""
  );

  if (entries.length === 0) return sql``;

  let result = sql``;

  entries.forEach(([column, val], index) => {
    const condition = sql`${sql(column)} = ${val.value}`;

    if (index === 0) {
      result = condition;
    } else {
      result = sql`${result} AND ${condition}`;
    }
  });

  return sql`AND ${result}`;
};

const getTasks = async (
  statusId,
  limit,
  offset,
  filters,
  order
) => {
  const orderBy =
    order === "ASC" ? sql`tb.created_at ASC` : sql`tb.created_at DESC`;

  return await sql`
    SELECT
      tb.id,
      tb.title,
      tb.description,
      tb.priority,
      tb.tags,
      tb.subtasks,
      tb.attachments,
      tb.due_date,
      tb.created_at,
      tb.status_id,

      jsonb_build_object(
        'id', c.id,
        'first_name', c.first_name,
        'last_name', c.last_name,
        'email', c.email
      ) AS contact,

      COALESCE(SUM(ts.duration_seconds), 0)::double precision AS time_spent

    FROM public.tasks tb
    LEFT JOIN public.contacts c ON tb.contact_id = c.id
    LEFT JOIN public.task_sessions ts ON ts.task_id = tb.id

    WHERE tb.status_id = ${statusId}
    ${buildFilters(filters)}

    GROUP BY tb.id, c.id

    ORDER BY ${orderBy}, tb.priority DESC
    LIMIT ${limit}
    OFFSET ${offset};
  `;
};

const getCount = async (statusId, filters) => {
  const res = await sql`
    SELECT COUNT(*)::int AS count
    FROM public.tasks tb
    WHERE tb.status_id = ${statusId}
    ${buildFilters(filters)}
  `;

  return res[0]?.count ?? 0;
};

export async function handleKanban(body) {
  const status_id =
    body.status_id !== undefined && body.status_id !== null
      ? Number(body.status_id)
      : null;

  const page = Number(body.page ?? 1);
  const limit = Number(body.limit ?? 20);
  const offset = (page - 1) * limit;

  const order = body.order === "ASC" ? "ASC" : "DESC";

  const filters =
    typeof body.filters === "object" && body.filters !== null
      ? body.filters
      : null;

  const boards = {};

  const statuses = await sql`
    SELECT id, name
    FROM public.task_boards
    ${status_id ? sql`WHERE id = ${status_id}` : sql``}
    ORDER BY sort_order ASC
  `;

  for (const status of statuses) {
    const [tasks, count] = await Promise.all([
      getTasks(status.id, limit, offset, filters, order),
      getCount(status.id, filters),
    ]);

    const enrichedTasks = tasks.map((t) => ({
      ...t,
      time_spent: Number(t.time_spent),
      time_spent_in_words: formatHMS(Number(t.time_spent)),
    }));

    boards[status.name] = {
      id: status.id,
      meta: {
        count,
        page,
        limit,
        order,
        has_more: offset + limit < count,
      },
      data: enrichedTasks,
    };
  }

  return boards;
}
