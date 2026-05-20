import { sql } from "./db.js";

/** Returns task_boards rows so the client can fill filters.status with real UUIDs. */
export async function handleBoards() {
  const rows = await sql`
    SELECT id, name, is_completed, sort_order
    FROM public.task_boards
    ORDER BY sort_order ASC
  `;

  return { data: rows };
}
