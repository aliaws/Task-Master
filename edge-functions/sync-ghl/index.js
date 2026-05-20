import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  CHECKPOINT_KEY_CONTACT,
  CHECKPOINT_KEY_TASK,
  SYNC_MODES,
} from "./sync-constants.js";
import { getToken, syncContacts, vault } from "./sync-ghl-contact-core.js";
import { syncTasks } from "./sync-ghl-tasks-core.js";
import { syncUsers } from "./sync-ghl-users-core.js";
import { syncTasksFromFile } from "./sync-ghl-tasks-from-file-core.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function parseSyncMode(req) {
  const url = new URL(req.url);
  return (url.searchParams.get("sync") || "all").toLowerCase();
}

async function runSync(mode, accessToken, locationId) {
  if (mode === "users") {
    const users = await syncUsers(accessToken, locationId);
    return { success: true, sync: "users", users };
  }

  if (mode === "tasks_from_file") {
    const tasks = await syncTasksFromFile();
    return { success: true, sync: "tasks_from_file", tasks };
  }

  if (mode === "contacts") {
    const contacts = await syncContacts(
      accessToken,
      locationId,
      CHECKPOINT_KEY_CONTACT
    );
    return { success: true, sync: "contacts", contacts };
  }

  if (mode === "tasks") {
    const tasks = await syncTasks(accessToken, CHECKPOINT_KEY_TASK);
    return { success: true, sync: "tasks", tasks };
  }

  const contacts = await syncContacts(
    accessToken,
    locationId,
    CHECKPOINT_KEY_CONTACT
  );
  const tasks = await syncTasks(accessToken, CHECKPOINT_KEY_TASK);

  return {
    success: true,
    sync: "all",
    contacts,
    tasks,
  };
}

serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Method not allowed. Use GET or POST." },
      405
    );
  }

  const mode = parseSyncMode(req);

  if (!SYNC_MODES.includes(mode)) {
    return jsonResponse(
      {
        success: false,
        error: `Invalid sync mode "${mode}". Use: ${SYNC_MODES.join(", ")}`,
        usage: {
          contacts: "/functions/v1/sync-ghl?sync=contacts",
          tasks: "/functions/v1/sync-ghl?sync=tasks",
          users: "/functions/v1/sync-ghl?sync=users",
          tasks_from_file: "/functions/v1/sync-ghl?sync=tasks_from_file",
          all: "/functions/v1/sync-ghl?sync=all",
        },
      },
      400
    );
  }

  try {
    if (mode === "tasks_from_file") {
      const result = await runSync(mode);
      return jsonResponse(result);
    }

    const v = await vault();
    const token = await getToken();

    if (!v.locationId) {
      return jsonResponse(
        { success: false, error: "Missing locationId in vault" },
        400
      );
    }

    const result = await runSync(mode, token.access_token, v.locationId);
    return jsonResponse(result);
  } catch (e) {
    return jsonResponse(
      { success: false, sync: mode, error: e?.message ?? String(e) },
      500
    );
  }
});
