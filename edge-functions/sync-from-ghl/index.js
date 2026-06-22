import postgres from "npm:postgres@3.4.4";
import { handleTaskCreate, handleTaskComplete, handleTaskDelete } from "./sync-tasks.js";
import { handleContactCreate, handleContactUpdate, handleContactDelete } from "./sync-contacts.js";
import { handleUserCreate, handleUserUpdate, handleUserDelete } from "./sync-users.js";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL"), { max: 5 });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(res, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }

    const payload = await req.json();
    console.log("=== GHL Webhook Payload ===");
    console.log(JSON.stringify(payload, null, 2));
    console.log("===========================");

    const eventType = payload.type;
    const ghlId = payload.id;

    if (!ghlId) {
      return json({ error: "Missing id in payload" }, 400);
    }

    let result;

    if (eventType === "TaskCreate") {
      result = await handleTaskCreate(sql, payload);
    } else if (eventType === "TaskComplete") {
      result = await handleTaskComplete(sql, ghlId);
    } else if (eventType === "TaskDelete") {
      result = await handleTaskDelete(sql, ghlId);
    } else if (eventType === "ContactCreate") {
      result = await handleContactCreate(sql, payload);
    } else if (eventType === "ContactUpdate") {
      result = await handleContactUpdate(sql, payload);
    } else if (eventType === "ContactDelete") {
      result = await handleContactDelete(sql, ghlId);
    } else if (eventType === "UserCreate") {
      result = await handleUserCreate(sql, payload);
    } else if (eventType === "UserUpdate") {
      result = await handleUserUpdate(sql, payload);
    } else if (eventType === "UserDelete") {
      result = await handleUserDelete(sql, ghlId);
    } else {
      console.warn("Unknown event type:", eventType);
      return json({ received: true, warning: "Unknown event type", type: eventType }, 200);
    }

    const status = result.warning ? 404 : 200;
    return json({ received: true, ...result }, status);
  } catch (err) {
    console.error("Error processing webhook:", err);
    return json({ error: String(err) }, 500);
  }
});
