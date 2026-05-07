import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ---------------- CONFIG ----------------
const BASE_URL = "https://services.leadconnectorhq.com";
const PAGE_SIZE = 100;

const STATUS_MAP: Record<string, number> = {
  true: 4,
  false: 1,
};

// ---------------- MAIN ----------------
Deno.serve(async () => {
  try {
    console.log("🚀 GHL Task Sync Started");

    // ---------------- TOKEN ----------------
    const { data: tokenData, error: tokenError } =
      await supabase.rpc("get_token_health");

    if (tokenError) throw new Error(tokenError.message);

    const accessToken = tokenData?.access_token;
    if (!accessToken) return new Response("Missing token", { status: 400 });

    // ---------------- VAULT ----------------
    const vault = await getVault();
    const locationId = vault?.locationId;

    if (!locationId) {
      return new Response("Missing locationId", { status: 400 });
    }

    // ---------------- CHECKPOINT ----------------
    const { data: checkpoint } = await supabase
      .from("sync_checkpoints")
      .select("*")
      .eq("key", "ghl_task_sync")
      .maybeSingle();

    let page = (checkpoint?.last_page || 0) + 1;
    let totalContacts = checkpoint?.total_contacts || 0;
    let totalTasks = checkpoint?.total_tasks || 0;

    console.log("📌 Resuming from page:", page);

    const userMap = await loadUserMap();

    const seenTasks = new Set<string>();
    let lastSyncedAt: string | null = null;

    // ---------------- LOOP ----------------
    while (true) {
      console.log(`📄 Fetching page ${page}`);

      const contacts = await fetchContacts(page, accessToken, locationId);
      if (!contacts.length) break;

      totalContacts += contacts.length;

      const contactIds = contacts.map((c: any) => c.id);
      const contactMap = await loadContactMap(contactIds);

      console.log("📦 CONTACT MAP SIZE:", Object.keys(contactMap).length);

      const batch: any[] = [];

      for (const contact of contacts) {
        const tasks = await fetchTasks(contact.id, accessToken);

        for (const task of tasks) {
          if (!task?.id || seenTasks.has(task.id)) continue;

          seenTasks.add(task.id);

          const transformed = transformTask(
            task,
            contactMap,
            userMap,
            contact.id
          );

          batch.push(transformed);
        }
      }

      // ---------------- UPSERT ----------------
      if (batch.length) {
        const { error } = await supabase
          .from("tasks")
          .upsert(batch, { onConflict: "ghl_id" });

        if (error) {
          console.error("❌ UPSERT ERROR:", error);
          throw error;
        }
      }

      totalTasks += batch.length;
      lastSyncedAt = new Date().toISOString();

      console.log(
        `✅ Page ${page} done | contacts: ${contacts.length} | tasks: ${batch.length}`
      );

      await saveCheckpoint({
        lastPage: page,
        totalContacts,
        totalTasks,
        lastSyncedAt,
      });

      page++;
    }

    console.log("🎉 SYNC COMPLETE");

    return new Response(
      JSON.stringify({
        success: true,
        totalContacts,
        totalTasks,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ ERROR:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message || String(err),
      }),
      { status: 500 }
    );
  }
});

// ---------------- TRANSFORM (SAFE) ----------------
function transformTask(
  task: any,
  contactMap: Record<string, string>,
  userMap: Record<string, string>,
  contactId: string
) {
  const contactUUID = contactMap[contactId] ?? null;
  const assignedUUID = userMap[task.assignedTo] ?? null;

  if (!contactUUID) {
    console.log("❌ Missing contact:", contactId);
  }

  if (task.assignedTo && !assignedUUID) {
    console.log("❌ Missing user:", task.assignedTo);
  }

  return {
    title: task.title,
    description: task.body || null,
    priority: task.priority || "Medium",

    tags: task.tags || [],
    subtasks: task.subtasks || [],
    attachments: task.attachments || [],

    contact_id: contactUUID,
    due_date: task.dueDate || null,

    ghl_id: task.id,

    status_id: STATUS_MAP[String(task.completed)],

    assigned_to: assignedUUID,

    updated_at: new Date().toISOString(),
  };
}

// ---------------- CONTACT MAP ----------------
async function loadContactMap(contactIds: string[]) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, ghl_id")
    .in("ghl_id", contactIds);

  if (error) {
    console.error("❌ CONTACT MAP ERROR:", error.message);
    return {};
  }

  const map: Record<string, string> = {};

  for (const c of data || []) {
    map[c.ghl_id] = c.id;
  }

  return map;
}

// ---------------- USER MAP ----------------
async function loadUserMap() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${url}/auth/v1/admin/users`, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
  });

  const json = await res.json();
  const users = json?.users || [];

  const map: Record<string, string> = {};

  for (const u of users) {
    const ghlId = u?.user_metadata?.ghl_id;
    if (ghlId) map[ghlId] = u.id;
  }

  console.log("👤 USERS LOADED:", Object.keys(map).length);

  return map;
}

// ---------------- CHECKPOINT ----------------
async function saveCheckpoint({
  lastPage,
  totalContacts,
  totalTasks,
  lastSyncedAt,
}: any) {
  await supabase.from("sync_checkpoints").upsert({
    key: "ghl_task_sync",
    last_page: lastPage,
    total_contacts: totalContacts,
    total_tasks: totalTasks,
    last_synced_at: lastSyncedAt,
    updated_at: new Date().toISOString(),
  });
}

// ---------------- API ----------------
async function fetchContacts(page: number, token: string, locationId: string) {
  const res = await fetch(`${BASE_URL}/contacts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locationId,
      page,
      pageLimit: PAGE_SIZE,
    }),
  });

  const data = await res.json();
  return data.contacts || [];
}

async function fetchTasks(contactId: string, token: string) {
  const res = await fetch(
    `${BASE_URL}/contacts/${contactId}/tasks`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
      },
    }
  );

  const data = await res.json();
  return data.tasks || [];
}

// ---------------- VAULT ----------------
async function getVault() {
  const { data, error } = await supabase.rpc("get_vault_secrets", {
    names: [],
  });

  if (error) throw new Error(error.message);
  return data || {};
}