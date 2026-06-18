import { syncContact } from "./sync-contacts.js";
import { syncUser } from "./sync-users.js";

export async function handleTaskCreate(sql, payload) {
  const contactUuid = await syncContact(sql, payload.contactId);
  const assignedToUuid = await syncUser(sql, payload.assignedTo);

  const result = await sql`
    INSERT INTO tasks ${sql({
      ghl_id: payload.id,
      title: payload.title || "Untitled Task",
      description: payload.body || null,
      contact_id: contactUuid,
      assigned_to: assignedToUuid,
      due_date: payload.dueDate || null,
      status_id: 1,
      created_at: payload.dateAdded || new Date().toISOString(),
    })}
    ON CONFLICT (ghl_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      contact_id = EXCLUDED.contact_id,
      assigned_to = EXCLUDED.assigned_to,
      due_date = EXCLUDED.due_date,
      updated_at = NOW()
    RETURNING id
  `;

  console.log("Task created/updated:", result[0].id);
  return { action: "created", task_id: result[0].id };
}

export async function handleTaskComplete(sql, ghlId) {
  const completedBoard = await sql`
    SELECT id FROM task_boards WHERE is_completed = true LIMIT 1
  `;

  if (completedBoard.length === 0) {
    console.error("No completed status found in task_boards");
    return { action: "completed", error: "No completed status configured" };
  }

  const completedStatusId = completedBoard[0].id;

  const result = await sql`
    UPDATE tasks SET status_id = ${completedStatusId}, updated_at = NOW()
    WHERE ghl_id = ${ghlId}
    RETURNING id
  `;

  if (result.length === 0) {
    console.warn("Task not found for completion, ghl_id:", ghlId);
    return { action: "completed", warning: "Task not found", ghl_id: ghlId };
  }

  console.log("Task completed:", result[0].id);
  return { action: "completed", task_id: result[0].id };
}

export async function handleTaskDelete(sql, ghlId) {
  const result = await sql`
    DELETE FROM tasks WHERE ghl_id = ${ghlId} RETURNING id
  `;

  if (result.length === 0) {
    console.warn("Task not found for deletion, ghl_id:", ghlId);
    return { action: "deleted", warning: "Task not found", ghl_id: ghlId };
  }

  console.log("Task deleted:", result[0].id);
  return { action: "deleted", task_id: result[0].id };
}
