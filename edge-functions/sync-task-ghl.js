const axios = require('axios');
const fs = require('fs').promises;

require('dotenv').config();

// ─── CONFIG ───────────────────────────────────────────────────────
const CONFIG = {
  apiToken:        process.env.API_TOKEN,
  locationId:      process.env.LOCATION_ID,
  baseUrl:         process.env.BASE_URL,// from your API docs
  contactPageSize: 100,                   // max per page
  concurrency:     10,                    // parallel task fetches
  retryAttempts:   3,
  retryDelay:      1000,                  // ms between retries
  pageDelay:       200,                   // ms between contact pages
  checkpointFile:  './checkpoint.json',
  outputFile:      './tasks.json',
};

const HEADERS = {
  Authorization: `Bearer ${CONFIG.apiToken}`,
  'Content-Type': 'application/json',
  Version: '2021-07-28',
};

// ─── UTILS ────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function withRetry(fn, attempts = CONFIG.retryAttempts) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = i === attempts - 1;
      if (isLast) throw err;
      console.warn(`  ⚠️  Retry ${i + 1}/${attempts - 1}...`);
      await sleep(CONFIG.retryDelay * (i + 1)); // exponential backoff
    }
  }
}

async function runInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn));
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
  }
  return results;
}

// ─── CHECKPOINT ───────────────────────────────────────────────────
async function loadCheckpoint() {
  try {
    const data = await fs.readFile(CONFIG.checkpointFile, 'utf8');
    return JSON.parse(data);
  } catch {
    return { lastPage: 0, totalContacts: 0, totalTasks: 0, startedAt: null };
  }
}

async function saveCheckpoint(data) {
  await fs.writeFile(CONFIG.checkpointFile, JSON.stringify(data, null, 2));
}

async function clearCheckpoint() {
  try { await fs.unlink(CONFIG.checkpointFile); } catch {}
}

// ─── API CALLS ────────────────────────────────────────────────────
async function fetchContactPage(page) {
  const res = await withRetry(() =>
    axios.post(
      `${CONFIG.baseUrl}/contacts/search`,
      { locationId: CONFIG.locationId, page, pageLimit: CONFIG.contactPageSize },
      { headers: HEADERS }
    )
  );
  return res.data;
}

async function fetchTasksForContact(contactId) {
  try {
    const res = await withRetry(() =>
      axios.get(`${CONFIG.baseUrl}/contacts/${contactId}/tasks`, { headers: HEADERS })
    );
    const tasks = res.data?.tasks || [];
    // Attach contactId to each task for reference
    return tasks.map((t) => ({ ...t, contactId }));
  } catch (err) {
    console.error(`  ❌ Failed for contact ${contactId}: ${err.message}`);
    return [];
  }
}

// ─── SAVE TO DB (replace with your DB logic) ──────────────────────
async function saveTasksToDB(tasks) {
  if (tasks.length === 0) return;
  // TODO: Replace this with your actual DB upsert logic
  // e.g. await db.collection('tasks').bulkWrite(upsertOps);
  const existing = [];
  try {
    const raw = await fs.readFile(CONFIG.outputFile, 'utf8');
    existing.push(...JSON.parse(raw));
  } catch {}

  const merged = [...existing, ...tasks];
  // Deduplicate by task ID
  const unique = Object.values(
    merged.reduce((acc, t) => ({ ...acc, [t.id]: t }), {})
  );
  await fs.writeFile(CONFIG.outputFile, JSON.stringify(unique, null, 2));
}

// ─── MAIN SYNC ────────────────────────────────────────────────────
async function syncAllTasks() {
  const checkpoint = await loadCheckpoint();
  let { lastPage, totalContacts, totalTasks } = checkpoint;

  const startPage = lastPage + 1;
  console.log(`\n🚀 Starting sync from page ${startPage}...\n`);
  if (lastPage > 0) console.log(`📌 Resuming from checkpoint (page ${lastPage})\n`);

  let currentPage = startPage;
  let hasMore = true;

  while (hasMore) {
    console.log(`📄 Fetching contacts — page ${currentPage}...`);

    let contacts, meta;
    try {
      ({ contacts, meta } = await fetchContactPage(currentPage));
    } catch (err) {
      console.error(`\n💥 Failed to fetch page ${currentPage}. Saving checkpoint & stopping.`);
      await saveCheckpoint({ lastPage: currentPage - 1, totalContacts, totalTasks, lastSyncedAt: new Date().toISOString() });
      process.exit(1);
    }

    if (!contacts || contacts.length === 0) {
      hasMore = false;
      break;
    }

    const contactIds = contacts.map((c) => c.id);
    console.log(`  → ${contactIds.length} contacts. Fetching tasks in parallel...`);

    const tasks = await runInBatches(contactIds, CONFIG.concurrency, fetchTasksForContact);

    // Save to DB immediately (memory efficient — no accumulation)
    await saveTasksToDB(tasks);

    totalContacts += contacts.length;
    totalTasks    += tasks.length;

    console.log(`  ✅ Page ${currentPage} done | Tasks: ${tasks.length} | Total contacts: ${totalContacts} | Total tasks: ${totalTasks}`);

    // Save checkpoint after every page
    await saveCheckpoint({
      lastPage: currentPage,
      totalContacts,
      totalTasks,
      lastSyncedAt: new Date().toISOString(),
    });

    const totalPages = meta?.total ? Math.ceil(meta.total / CONFIG.contactPageSize) : null;
    hasMore = totalPages ? currentPage < totalPages : contacts.length === CONFIG.contactPageSize;
    currentPage++;

    await sleep(CONFIG.pageDelay);
  }

  await clearCheckpoint();
  console.log(`\n🎉 Sync complete!`);
  console.log(`   Total contacts processed : ${totalContacts}`);
  console.log(`   Total tasks fetched       : ${totalTasks}`);
  console.log(`   Output saved to           : ${CONFIG.outputFile}\n`);
}

// ─── RUN ──────────────────────────────────────────────────────────
syncAllTasks().catch((err) => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});