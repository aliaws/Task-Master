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

type NotificationRow = {
  id: number;
  task_id: number;
  is_viewed: boolean;
  viewed_at: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ success: false, error: "Method not allowed. Use POST." }, 405);
    }

    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      return json({ success: false, error: "SUPABASE_DB_URL not configured" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const rawId = body.notification_id ?? body.id;
    const notificationId = Number(rawId);

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return json(
        { success: false, error: "notification_id must be a positive integer" },
        400
      );
    }

    const updated = await sql<NotificationRow[]>`
      UPDATE public.email_notifications
      SET
        is_viewed = true,
        viewed_at = now()
      WHERE id = ${notificationId}
        AND viewed_at IS NULL
      RETURNING id, task_id, is_viewed, viewed_at
    `;

    if (updated.length) {
      const row = updated[0];
      return json({
        success: true,
        first_view: true,
        notification_id: row.id,
        task_id: row.task_id,
        is_viewed: row.is_viewed,
        viewed_at: row.viewed_at,
      });
    }

    const existing = await sql<NotificationRow[]>`
      SELECT id, task_id, is_viewed, viewed_at
      FROM public.email_notifications
      WHERE id = ${notificationId}
      LIMIT 1
    `;

    if (!existing.length) {
      return json({ success: false, error: "Notification not found" }, 404);
    }

    const row = existing[0];
    return json({
      success: true,
      first_view: false,
      notification_id: row.id,
      task_id: row.task_id,
      is_viewed: row.is_viewed,
      viewed_at: row.viewed_at,
    });
  } catch (err) {
    return json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500
    );
  } finally {
    await sql.end();
  }
});
