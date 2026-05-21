import { handleKanban } from "./kanban-action.js";
import { handleBoards } from "./boards-action.js";
import { handleList } from "./list.js";
import { handleTaskDetail } from "./task-detail.js";
import { handleTagsSearch } from "./tags-action.js";
import { jsonResponse } from "./utils.js";

const ACTIONS = ["kanban", "list", "task_detail", "tags", "boards"];

function parseAction(req, body) {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("action");
  const fromBody = body?.action;

  return (fromBody || fromQuery || "kanban").toLowerCase();
}

Deno.serve(async (req) => {
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
                "List filter SQL: query.js buildListWhere + list.js. filters.status = integer task_boards.id; filters.contacts = UUID contacts.id only.",
            }
          : {}),
      },
      500
    );
  }
});
