import { sql } from "./db.js";

export async function handleTagsSearch(body) {
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 20) || 20));

  const rows = await sql`
    SELECT * FROM public.search_tags(${q}, ${limit})
  `;

  return {
    data: rows.map((r) => ({ id: r.id, name: r.name })),
    meta: { q, limit, count: rows.length },
  };
}
