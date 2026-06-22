import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

/** Maps GHL task.completed (boolean) to task_boards.id from is_completed column. */
export async function loadTaskStatusMap() {
  const { data, error } = await supabase
    .from("task_boards")
    .select("id, is_completed");

  if (error) throw error;

  const completed = data?.find((b) => b.is_completed === true);
  const incomplete = data?.find((b) => b.is_completed === false);

  if (!completed?.id || !incomplete?.id) {
    throw new Error(
      "task_boards must include one row with is_completed=true and one with is_completed=false"
    );
  }

  return {
    true: completed.id,
    false: incomplete.id,
  };
}
