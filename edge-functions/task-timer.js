import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 5 });

function formatHMS(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours} hour, ${minutes} minutes, ${secs} seconds`;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Use POST", { status: 405 });
    }

    const body = await req.json().catch(() => ({}));

    const task_id = Number(body.task_id);

    // duration_seconds is optional now
    const hasDuration =
      body.duration_seconds !== undefined && body.duration_seconds !== null;
    const duration_seconds = hasDuration ? Number(body.duration_seconds) : null;

    if (!task_id) {
      return new Response(
        JSON.stringify({ error: "task_id required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Insert only if duration_seconds is provided
    if (duration_seconds !== null) {
      if (Number.isNaN(duration_seconds) || duration_seconds <= 0) {
        return new Response(
          JSON.stringify({ error: "duration_seconds must be a positive number" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      await sql`
        INSERT INTO task_sessions (task_id, duration_seconds)
        VALUES (${task_id}, ${duration_seconds})
      `;
    }

    // Always return current total time spent
    const totalResult = await sql`
      SELECT COALESCE(SUM(duration_seconds), 0)::double precision AS total
      FROM task_sessions
      WHERE task_id = ${task_id}
    `;

    const time_spent = Number(totalResult[0].total);
    const time_spent_in_words = formatHMS(time_spent);

    return new Response(
      JSON.stringify({
        time_spent,       // numeric seconds
        time_spent_in_words,  // "1 hour, 12 minutes, 35 seconds"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await sql.end();
  }
});
