import { sql } from "./db.js";

function parseTasksPayload(body) {
  const raw = body.tasks;

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      'tasks is required: non-empty array of { "task_id": number, "task_order": number }'
    );
  }

  if (raw.length > 500) {
    throw new Error("tasks array exceeds maximum of 500 items");
  }

  const items = [];
  const seen = new Set();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Each tasks entry must be an object");
    }

    const taskId = Number(entry.task_id ?? entry.id);
    const taskOrder = Number(entry.task_order);

    if (!Number.isInteger(taskId) || taskId <= 0) {
      throw new Error(
        `Invalid task_id: ${entry.task_id ?? entry.id} (must be a positive integer)`
      );
    }

    if (!Number.isInteger(taskOrder) || taskOrder < 0) {
      throw new Error(
        `Invalid task_order for task_id ${taskId} (must be a non-negative integer)`
      );
    }

    if (seen.has(taskId)) {
      throw new Error(`Duplicate task_id in payload: ${taskId}`);
    }
    seen.add(taskId);

    items.push({ task_id: taskId, task_order: taskOrder });
  }

  return items;
}

export async function handleUpdateTaskOrder(body) {
  const items = parseTasksPayload(body);

  const updated = await sql.begin(async (tx) => {
    const results = [];

    for (const { task_id, task_order } of items) {
      const rows = await tx`
        UPDATE public.tasks
        SET task_order = ${task_order}
        WHERE id = ${task_id}
        RETURNING id, task_order
      `;

      if (rows.length) {
        results.push({
          task_id: rows[0].id,
          task_order: Number(rows[0].task_order),
        });
      }
    }

    return results;
  });

  const updatedIds = new Set(updated.map((row) => row.task_id));
  const notFound = items
    .filter((item) => !updatedIds.has(item.task_id))
    .map((item) => item.task_id);

  return {
    updated: updated.length,
    tasks: updated,
    ...(notFound.length ? { not_found: notFound } : {}),
  };
}
