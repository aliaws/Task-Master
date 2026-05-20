import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CHECKPOINT_KEY_TASK,
  GHL_API_VERSION,
  GHL_BASE_URL,
  TASK_CONTACT_BATCH_SIZE,
} from "./sync-constants.js";
import { loadUserMap } from "./sync-ghl-users-core.js";
import { loadTaskStatusMap } from "./sync-ghl-task-boards.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

function hasSavedCursor(data) {
  return data?.last_cursor != null && data.last_cursor !== "";
}

async function getTaskCheckpoint(checkpointKey = CHECKPOINT_KEY_TASK) {
  const { data, error } = await supabase
    .from("sync_checkpoints")
    .select("*")
    .eq("key", checkpointKey)
    .maybeSingle();

  if (error) throw error;

  return {
    lastCursor: hasSavedCursor(data) ? data.last_cursor : null,
    totalContactsProcessed: data?.total_contacts_processed || 0,
    totalTasksSaved: data?.total_saved_tasks || 0,
    isInitialSync: !hasSavedCursor(data),
  };
}

async function saveTaskCheckpoint({
  lastCursor,
  totalContactsProcessed,
  totalTasksSaved,
  checkpointKey = CHECKPOINT_KEY_TASK,
}) {
  const row = {
    key: checkpointKey,
    last_cursor: lastCursor,
    total_contacts_processed: totalContactsProcessed,
    total_saved_tasks: totalTasksSaved,
  };

  const { data: existing, error: readError } = await supabase
    .from("sync_checkpoints")
    .select("key")
    .eq("key", checkpointKey)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    const { error } = await supabase
      .from("sync_checkpoints")
      .update(row)
      .eq("key", checkpointKey);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("sync_checkpoints").insert(row);
  if (error) throw error;
}

async function fetchContactsFromDb(lastCursor) {
  let query = supabase
    .from("contacts")
    .select("id, ghl_id")
    .order("id", { ascending: true })
    .limit(TASK_CONTACT_BATCH_SIZE);

  if (lastCursor) {
    query = query.gt("id", lastCursor);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function updateContactTaskCount(contactId, taskCount) {
  const { error } = await supabase
    .from("contacts")
    .update({ total_tasks: taskCount })
    .eq("id", contactId);

  if (error) throw error;
}

async function fetchTasksFromGhl(ghlContactId, token) {
  const res = await fetch(
    `${GHL_BASE_URL}/contacts/${ghlContactId}/tasks`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_API_VERSION,
      },
    }
  );

  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();
  return data.tasks ?? [];
}

export function transformTask(task, contactRow, userMap, statusMap) {
  const assignedUUID = userMap[task.assignedTo] ?? null;

  return {
    title: task.title,
    description: task.body || null,
    priority: task.priority || "Medium",
    tags: task.tags || [],
    subtasks: task.subtasks || [],
    attachments: task.attachments || [],
    contact_id: contactRow.id,
    due_date: task.dueDate || null,
    ghl_id: task.id,
    status_id: statusMap[String(task.completed)],
    assigned_to: assignedUUID,
    updated_at: new Date().toISOString(),
  };
}

export async function syncTasks(
  token,
  checkpointKey = CHECKPOINT_KEY_TASK
) {
  const checkpoint = await getTaskCheckpoint(checkpointKey);
  const [userMap, statusMap] = await Promise.all([
    loadUserMap(),
    loadTaskStatusMap(),
  ]);
  const seenTasks = new Set();

  let lastCursor = checkpoint.lastCursor;
  let totalContactsProcessed = checkpoint.totalContactsProcessed;
  let totalTasksSaved = checkpoint.totalTasksSaved;
  let syncedThisRun = 0;
  let contactsThisRun = 0;

  while (true) {
    const contacts = await fetchContactsFromDb(lastCursor);
    if (!contacts.length) break;

    const batch = [];

    for (const contact of contacts) {
      lastCursor = contact.id;
      contactsThisRun++;
      totalContactsProcessed++;

      if (!contact.ghl_id) {
        await updateContactTaskCount(contact.id, 0);
        continue;
      }

      const tasks = await fetchTasksFromGhl(contact.ghl_id, token);

      for (const task of tasks) {
        if (!task?.id || seenTasks.has(task.id)) continue;
        seenTasks.add(task.id);
        batch.push(transformTask(task, contact, userMap, statusMap));
      }

      await updateContactTaskCount(contact.id, tasks.length);
    }

    if (batch.length) {
      const { error } = await supabase
        .from("tasks")
        .upsert(batch, { onConflict: "ghl_id" });

      if (error) throw error;

      syncedThisRun += batch.length;
      totalTasksSaved += batch.length;
    }

    await saveTaskCheckpoint({
      lastCursor,
      totalContactsProcessed,
      totalTasksSaved,
      checkpointKey,
    });

    if (contacts.length < TASK_CONTACT_BATCH_SIZE) break;
  }

  const { count: totalContactsInDb } = await supabase
    .from("contacts")
    .select("id", { count: "exact", head: true });

  const tasksDone =
    totalContactsInDb != null &&
    totalContactsProcessed >= totalContactsInDb;

  return {
    success: true,
    synced: syncedThisRun,
    contactsProcessed: contactsThisRun,
    totalContactsProcessed,
    totalTasksSaved,
    lastCursor,
    isInitialSync: checkpoint.isInitialSync,
    tasksDone,
    done: true,
  };
}
