import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TASK_LIST } from "./task_list.js";
import { loadUserMap } from "./sync-ghl-users-core.js";
import { loadTaskStatusMap } from "./sync-ghl-task-boards.js";
import { transformTask } from "./sync-ghl-tasks-core.js";

const UPSERT_BATCH_SIZE = 200;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

async function loadContactMap(ghlContactIds) {
  if (!ghlContactIds.length) return {};

  const { data, error } = await supabase
    .from("contacts")
    .select("id, ghl_id")
    .in("ghl_id", ghlContactIds);

  if (error) throw error;

  const map = {};
  for (const row of data ?? []) {
    if (row.ghl_id) map[row.ghl_id] = row;
  }
  return map;
}

async function upsertTaskBatches(rows) {
  let synced = 0;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from("tasks")
      .upsert(chunk, { onConflict: "ghl_id" });

    if (error) throw error;
    synced += chunk.length;
  }

  return synced;
}

export async function syncTasksFromList() {
  const tasks = TASK_LIST;
  const [userMap, statusMap] = await Promise.all([
    loadUserMap(),
    loadTaskStatusMap(),
  ]);

  const ghlContactIds = [
    ...new Set(tasks.map((t) => t.contactId).filter(Boolean)),
  ];
  const contactMap = await loadContactMap(ghlContactIds);

  const batch = [];
  let skipped = 0;

  for (const task of tasks) {
    if (!task?.id) {
      skipped++;
      continue;
    }

    const contactRow = contactMap[task.contactId];
    if (!contactRow) {
      skipped++;
      continue;
    }

    batch.push(transformTask(task, contactRow, userMap, statusMap));
  }

  const synced = batch.length ? await upsertTaskBatches(batch) : 0;

  return {
    success: true,
    totalInList: tasks.length,
    synced,
    skipped,
    done: true,
  };
}
