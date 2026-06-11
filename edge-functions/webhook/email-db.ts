import postgres from "npm:postgres@3.4.4";

export const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  max: 2,
  idle_timeout: 20,
  connect_timeout: 10,
});
