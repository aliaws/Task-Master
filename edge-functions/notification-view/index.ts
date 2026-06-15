import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 5 });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type LogRow = {
  id: number;
  task_id: number;
  is_viewed: boolean;
  viewed_at: string | null;
};

function formatResponse(row: LogRow, firstView: boolean) {
  return {
    success: true,
    first_view: firstView,
    log_id: row.id,
    notification_id: row.id,
    task_id: row.task_id,
    is_viewed: row.is_viewed,
    viewed_at: row.viewed_at,
  };
}

Deno.serve(async (req: Request) => {
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
    const rawId = body.log_id ?? body.notification_id ?? body.id;
    const logId = Number(rawId);

    if (!Number.isInteger(logId) || logId <= 0) {
      return json(
        {
          success: false,
          error: "log_id (or notification_id) must be a positive integer",
        },
        400
      );
    }

    const updated = await sql<LogRow[]>`
      UPDATE public.task_change_logs
      SET is_viewed = true, viewed_at = now()
      WHERE id = ${logId} AND viewed_at IS NULL
      RETURNING id, task_id, is_viewed, viewed_at
    `;

    if (updated.length) {
      return json(formatResponse(updated[0], true));
    }

    const existing = await sql<LogRow[]>`
      SELECT id, task_id, is_viewed, viewed_at
      FROM public.task_change_logs
      WHERE id = ${logId}
      LIMIT 1
    `;

    if (!existing.length) {
      return json({ success: false, error: "Log entry not found" }, 404);
    }

    return json(formatResponse(existing[0], false));
  } catch (err) {
    return json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500
    );
  } finally {
    await sql.end();
  }
});
