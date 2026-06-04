import { sql } from "./db.js";
import {
  buildAssignee,
  formatHMS,
  parseDescriptionTruncateLength,
  truncateDescription,
} from "./utils.js";

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
      tb.data_source,
      tb.created_at,
      tb.status_id,

      jsonb_build_object(
        'id', c.id,
        'first_name', c.first_name,
        'last_name', c.last_name,
        'email', c.email
      ) AS contact,

      COALESCE(SUM(ts.duration_seconds), 0)::double precision AS time_spent,

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

    FROM public.tasks tb
    LEFT JOIN public.contacts c ON tb.contact_id = c.id
    LEFT JOIN auth.users u ON u.id = tb.assigned_to
    LEFT JOIN public.task_sessions ts ON ts.task_id = tb.id

    WHERE tb.status_id = ${statusId}
    ${buildFilters(filters)}

    GROUP BY tb.id, c.id, u.id

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

  const descriptionTruncateLength = parseDescriptionTruncateLength(body);

  const boards = {};

  const statuses = await sql`
    SELECT id, name, is_completed, sort_order
    FROM public.task_boards
    ${status_id ? sql`WHERE id = ${status_id}` : sql``}
    ORDER BY sort_order ASC
  `;

  for (const status of statuses) {
    const [tasks, count] = await Promise.all([
      getTasks(status.id, limit, offset, filters, order),
      getCount(status.id, filters),
    ]);

    const enrichedTasks = tasks.map((t) => {
      const { assigned_id, assignee_display_name, ...rest } = t;
      return {
        ...rest,
        description_truncated: truncateDescription(
          t.description,
          descriptionTruncateLength
        ),
        assigned_to: buildAssignee({ assigned_id, assignee_display_name }),
        time_spent: Number(t.time_spent),
        time_spent_in_words: formatHMS(Number(t.time_spent)),
      };
    });

    boards[status.name] = {
      id: status.id,
      is_completed: Boolean(status.is_completed),
      sort_order: Number(status.sort_order),
      meta: {
        count,
        page,
        limit,
        order,
        has_more: offset + limit < count,
        description_truncate_length: descriptionTruncateLength,
      },
      data: enrichedTasks,
    };
  }

  return boards;
}
