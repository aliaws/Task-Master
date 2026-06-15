import { sql } from "./db.js";
import {
  buildAssignee,
  buildContact,
  buildStatus,
  buildTimeSpent,
} from "./utils.js";
import { TASK_FROM_JOINS, TASK_SELECT_CORE } from "./query.js";

function mapDetailRow(row) {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    status: buildStatus(row),
    description: row.description,
    contact: buildContact(row),
    assigned_to: buildAssignee(row),
    due_date: row.due_date,
    task_order: Number(row.task_order ?? 0),
    time_start_at: row.time_start_at ?? null,
    ghl_id: row.ghl_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...buildTimeSpent(row),
    subtasks: row.subtasks ?? [],
    attachments: row.attachments ?? [],
    tags: row.tags ?? [],
  };
}

export async function handleTaskDetail(body) {
  const taskId = body.id ?? body.task_id;
  if (taskId === undefined || taskId === null || taskId === "") {
    throw new Error("id is required for task_detail (integer tasks.id)");
  }

  const taskIdInt = Number(taskId);
  if (!Number.isInteger(taskIdInt)) {
    throw new Error("id must be an integer (tasks.id)");
  }

  const rows = await sql`
    SELECT
      ${TASK_SELECT_CORE},
      tb.time_start_at,
      tb.subtasks,
      tb.attachments,
      tb.tags
    ${TASK_FROM_JOINS}
    WHERE tb.id = ${taskIdInt}
    LIMIT 1
  `;

  if (!rows.length) {
    return { data: null };
  }

  const logs = await sql`
    SELECT
      id,
      field_name,
      old_display_value,
      new_display_value,
      changed_by_name,
      is_viewed,
      viewed_at,
      created_at
    FROM public.task_change_logs
    WHERE task_id = ${taskIdInt}
    ORDER BY created_at ASC
    LIMIT 50
  `;

  return { data: { ...mapDetailRow(rows[0]), logs } };
}
