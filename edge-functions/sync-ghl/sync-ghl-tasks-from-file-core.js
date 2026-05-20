import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadUserMap } from "./sync-ghl-users-core.js";
import { loadTaskStatusMap } from "./sync-ghl-task-boards.js";
import { transformTask } from "./sync-ghl-tasks-core.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

const TASKS_FILE_PATHS = [
  new URL("./tasks.json", import.meta.url),
  new URL("../tasks.json", import.meta.url),
];

async function loadTasksJson() {
  for (const path of TASKS_FILE_PATHS) {
    try {
      const text = await Deno.readTextFile(path);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error("tasks.json must be a JSON array");
      }
      return parsed;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw e;
    }
  }

  throw new Error(
    "tasks.json not found. Place it in edge-functions/tasks.json or edge-functions/sync-ghl/tasks.json"
  );
}

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

export async function syncTasksFromFile() {
  const tasks = await loadTasksJson();
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

  if (batch.length) {
    const { error } = await supabase
      .from("tasks")
      .upsert(batch, { onConflict: "ghl_id" });

    if (error) throw error;
  }

  return {
    success: true,
    totalInFile: tasks.length,
    synced: batch.length,
    skipped,
    done: true,
  };
}
