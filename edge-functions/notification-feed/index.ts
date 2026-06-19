import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL"), { max: 5 });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(res, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function initialsFromDisplayName(displayName: string): string | null {
  if (!displayName || typeof displayName !== "string") return null;
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const target = parts.slice(0, 2);
  return target.map((p) => p.charAt(0).toUpperCase()).join("");
}

function parsePagination(body) {
  const page = Math.max(1, Number(body.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 20) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

async function handleList(body) {
  const userId = body.user_id ? String(body.user_id).trim() : null;
  if (!userId || !UUID_RE.test(userId)) {
    return json({ success: false, error: "user_id is required (valid auth user UUID)" }, 400);
  }

  const userRows = await sql`
    SELECT email FROM auth.users WHERE id = ${userId} LIMIT 1
  `;
  if (!userRows.length) {
    return json({ success: false, error: "User not found" }, 400);
  }
  const email = userRows[0].email;

  const { page, limit, offset } = parsePagination(body);

  const raw = await sql`
    (
      SELECT
        'mention' AS type,
        l.id AS log_id,
        l.task_id,
        t.title AS task_title,
        (l.new_value->>'comment_id')::int AS comment_id,
        l.new_value->>'snippet' AS content_preview,
        l.field_name,
        l.old_display_value,
        l.new_display_value,
        l.changed_by_name,
        l.is_viewed,
        l.viewed_at,
        l.created_at
      FROM public.task_change_logs l
      LEFT JOIN public.tasks t ON t.id = l.task_id
      WHERE l.field_name = 'mention' AND l.recipient_email = ${email}
        AND l.changed_by_user_id IS DISTINCT FROM t.assigned_to
    )
    UNION ALL
    (
      SELECT
        'task_change' AS type,
        l.id AS log_id,
        l.task_id,
        t.title AS task_title,
        NULL::int AS comment_id,
        NULL::text AS content_preview,
        l.field_name,
        l.old_display_value,
        l.new_display_value,
        l.changed_by_name,
        l.is_viewed,
        l.viewed_at,
        l.created_at
      FROM public.task_change_logs l
      LEFT JOIN public.tasks t ON t.id = l.task_id
      WHERE l.task_id IN (SELECT id FROM public.tasks WHERE assigned_to = ${userId})
        AND l.field_name IN ('assigned_to', 'status_id', 'due_date', 'priority')
        AND l.changed_by_user_id IS DISTINCT FROM t.assigned_to
    )
    UNION ALL
    (
      SELECT
        'comment' AS type,
        NULL::bigint AS log_id,
        c.task_id,
        t.title AS task_title,
        c.id AS comment_id,
        c.content AS content_preview,
        NULL::text AS field_name,
        NULL::text AS old_display_value,
        c.content AS new_display_value,
        c.display_name AS changed_by_name,
        false AS is_viewed,
        NULL::timestamptz AS viewed_at,
        c.created_at
      FROM public.task_comments c
      LEFT JOIN public.tasks t ON t.id = c.task_id
      WHERE c.task_id IN (SELECT id FROM public.tasks WHERE assigned_to = ${userId})
        AND c.user_id IS DISTINCT FROM t.assigned_to
    )
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const countRows = await sql`
    SELECT COUNT(*)::int AS total FROM (
      SELECT l.id::bigint FROM public.task_change_logs l
      LEFT JOIN public.tasks t ON t.id = l.task_id
      WHERE l.field_name = 'mention' AND l.recipient_email = ${email}
        AND l.changed_by_user_id IS DISTINCT FROM t.assigned_to
      UNION ALL
      SELECT l.id::bigint FROM public.task_change_logs l
      LEFT JOIN public.tasks t ON t.id = l.task_id
      WHERE l.task_id IN (SELECT id FROM public.tasks WHERE assigned_to = ${userId})
        AND l.field_name IN ('assigned_to', 'status_id', 'due_date', 'priority')
        AND l.changed_by_user_id IS DISTINCT FROM t.assigned_to
      UNION ALL
      SELECT c.id::bigint FROM public.task_comments c
      LEFT JOIN public.tasks t ON t.id = c.task_id
      WHERE c.task_id IN (SELECT id FROM public.tasks WHERE assigned_to = ${userId})
        AND c.user_id IS DISTINCT FROM t.assigned_to
    ) sub
  `;

  const count = countRows[0]?.total ?? 0;
  const totalPages = count > 0 ? Math.ceil(count / limit) : 0;

  return json({
    success: true,
    action: "list",
    data: raw.map((r) => ({
      type: r.type,
      notification_id: Number(r.log_id ?? r.comment_id),
      task_id: Number(r.task_id),
      task_title: r.task_title ?? null,
      comment_id: r.comment_id != null ? Number(r.comment_id) : null,
      content_preview: r.content_preview ?? null,
      field_name: r.field_name ?? null,
      old_display_value: r.old_display_value ?? null,
      new_display_value: r.new_display_value ?? null,
      changed_by_name: r.changed_by_name ?? null,
      initials: initialsFromDisplayName(r.changed_by_name ?? ""),
      is_viewed: Boolean(r.is_viewed),
      viewed_at: r.viewed_at ?? null,
      created_at: r.created_at,
    })),
    meta: {
      count,
      page,
      limit,
      total_pages: totalPages,
      has_more: page < totalPages,
    },
  });
}

async function handleMarkRead(body) {
  const rawIds = body.log_ids ?? body.ids ?? body.notification_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return json({ success: false, error: "log_ids must be a non-empty array of integers" }, 400);
  }

  const ids = rawIds
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!ids.length) {
    return json({ success: false, error: "log_ids must contain positive integers" }, 400);
  }

  const result = await sql`
    UPDATE public.task_change_logs
    SET is_viewed = true, viewed_at = now()
    WHERE id IN ${sql(ids)} AND viewed_at IS NULL
    RETURNING id
  `;

  return json({
    success: true,
    action: "mark_read",
    updated: result.length,
    total_provided: ids.length,
    log_ids: ids,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ success: false, error: "Method not allowed. Use POST." }, 405);
    }

    if (!Deno.env.get("SUPABASE_DB_URL")) {
      return json({ success: false, error: "SUPABASE_DB_URL not configured" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const action = (body.action || "list").toLowerCase();

    if (action === "list") {
      return await handleList(body);
    } else if (action === "mark_read") {
      return await handleMarkRead(body);
    } else {
      return json({ success: false, error: `Invalid action "${action}". Use: list, mark_read` }, 400);
    }
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  } finally {
    await sql.end();
  }
});
