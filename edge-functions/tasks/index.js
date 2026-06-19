import { handleKanban } from "./kanban-action.js";
import { handleBoards } from "./boards-action.js";
import { handleList } from "./list.js";
import { handleTaskDetail } from "./task-detail.js";
import { handleTagsSearch } from "./tags-action.js";
import { handleContactsLookup } from "./contacts-action.js";
import { handleCountryCodes } from "./country-codes-action.js";
import {
  handleUserCreate,
  handleUserDelete,
  handleUsersLookup,
  handleUserUpdate,
} from "./users-action.js";
import { handleUpdateTaskOrder } from "./update-task-order-action.js";
import { corsPreflightResponse, jsonResponse } from "./utils.js";

const ACTIONS = [
  "kanban",
  "list",
  "task_detail",
  "tags",
  "boards",
  "contacts",
  "country_codes",
  "users",
  "user_create",
  "user_update",
  "user_delete",
  "update_task_order",
];

function parseAction(req, body) {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("action");
  const fromBody = body?.action;

  const raw = (fromBody || fromQuery || "kanban").toLowerCase();
  return raw.replace(/-/g, "_");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsPreflightResponse();
  }

  let action;

  try {
    if (req.method !== "POST") {
      return jsonResponse(
        { success: false, error: "Method not allowed. Use POST." },
        405
      );
    }

    const body = await req.json().catch(() => ({}));
    action = parseAction(req, body);

    if (!ACTIONS.includes(action)) {
      return jsonResponse(
        {
          success: false,
          error: `Invalid action "${action}". Use: ${ACTIONS.join(", ")}`,
          usage: {
            kanban: "?action=kanban",
            list: "?action=list",
            task_detail: "?action=task_detail",
            tags: "?action=tags",
            boards: "?action=boards",
            contacts: "?action=contacts",
            country_codes: "?action=country_codes",
            users: "?action=users",
            user_create: "?action=user_create",
            user_update: "?action=user_update",
            user_delete: "?action=user_delete",
            update_task_order: "?action=update_task_order",
          },
        },
        400
      );
    }

    let result;

    if (action === "kanban") {
      result = await handleKanban(body);
    } else if (action === "boards") {
      result = await handleBoards();
    } else if (action === "list") {
      result = await handleList(body);
    } else if (action === "task_detail") {
      result = await handleTaskDetail(body);
    } else if (action === "tags") {
      result = await handleTagsSearch(body);
    } else if (action === "contacts") {
      result = await handleContactsLookup(body);
    } else if (action === "country_codes") {
      result = await handleCountryCodes();
    } else if (action === "users") {
      result = await handleUsersLookup(body);
    } else if (action === "user_create") {
      result = await handleUserCreate(body);
    } else if (action === "user_update") {
      result = await handleUserUpdate(body);
    } else if (action === "user_delete") {
      result = await handleUserDelete(body);
    } else if (action === "update_task_order") {
      result = await handleUpdateTaskOrder(body);
    }

    return jsonResponse({ success: true, action, ...result });
  } catch (err) {
    const message = err?.message ?? String(err);
    const isSqlSyntax =
      typeof message === "string" &&
      message.includes("syntax error") &&
      message.includes("AND");

    return jsonResponse(
      {
        success: false,
        error: message,
        ...(isSqlSyntax && action === "list"
          ? {
              hint:
                "List filters: status = integer task_boards.id; contacts = UUID; priority = exact string; title + title_match for search.",
            }
          : {}),
      },
      500
    );
  }
});
