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

function formatHMS(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return `${hours} hour, ${minutes} minutes, ${secs} seconds`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }

    const body = await req.json().catch(() => ({}));

    const task_id = Number(body.task_id);
    const type = body.type || "TRACKED";
    const user_id = body.user_id || null;

    const hasDuration =
      body.duration_seconds !== undefined &&
      body.duration_seconds !== null;

    const duration_seconds = hasDuration
      ? Number(body.duration_seconds)
      : null;

    if (!task_id) {
      return json({ error: "task_id required" }, 400);
    }

    if (duration_seconds !== null) {
      if (Number.isNaN(duration_seconds) || duration_seconds <= 0) {
        return json(
          { error: "duration_seconds must be a positive number" },
          400
        );
      }

      await sql`
        INSERT INTO task_sessions (
          task_id,
          duration_seconds,
          type,
          updated_by,
          updated_at
        )
        VALUES (
          ${task_id},
          ${duration_seconds},
          ${type},
          ${user_id},
          NOW()
        )
      `;
    }

    const totalResult = await sql`
      SELECT COALESCE(SUM(duration_seconds), 0)::double precision AS total
      FROM task_sessions
      WHERE task_id = ${task_id}
    `;

    const time_spent = Number(totalResult[0].total);
    const time_spent_in_words = formatHMS(time_spent);

    return json({
      task_id,
      time_spent,
      time_spent_in_words,
    });
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      500
    );
  } finally {
    await sql.end();
  }
});
