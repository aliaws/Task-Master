import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,

  debug: (conn, query, params) => {
    console.log("\n--- SQL ---");
    console.log(query);
    console.log("PARAMS:", params);
    console.log("------------\n");
  },
});

/**
 * Format seconds into readable string
 */
const formatHMS = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours} hour, ${minutes} minutes, ${secs} seconds`;
};

/**
 * FILTER BUILDER
 */
const buildFilters = (filters: Record<string, any> | null) => {
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

/**
 * GET TASKS (with time_spent)
 */
const getTasks = async (
  statusId: number,
  limit: number,
  offset: number,
  filters: Record<string, any> | null,
  order: "ASC" | "DESC"
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

/**
 * COUNT TASKS
 */
const getCount = async (
  statusId: number,
  filters: Record<string, any> | null
) => {
  const res = await sql`
    SELECT COUNT(*)::int AS count
    FROM public.tasks tb
    WHERE tb.status_id = ${statusId}
    ${buildFilters(filters)}
  `;

  return res[0]?.count ?? 0;
};

/**
 * API
 */
Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Use POST", { status: 405 });
    }

    const body = await req.json().catch(() => ({}));

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

    const boards: Record<string, any> = {};

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

      const enrichedTasks = tasks.map((t: any) => ({
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

    return new Response(JSON.stringify(boards), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
