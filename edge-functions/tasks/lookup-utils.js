import { buildIlikePattern, normalizeSearchOperator } from "./search-utils.js";

export function parseLookupLimit(body) {
  return Math.min(100, Math.max(1, Number(body.limit ?? 20) || 20));
}

export function parseLookupPage(body) {
  return Math.max(1, Number(body.page ?? 1) || 1);
}

export function lookupPaginationMeta({
  count,
  page,
  limit,
  extra = {},
}) {
  const total_pages = count > 0 ? Math.ceil(count / limit) : 0;

  return {
    count,
    page,
    limit,
    total_pages,
    has_more: page < total_pages,
    ...extra,
  };
}

export function parseLookupQuery(body) {
  return typeof body.q === "string" ? body.q.trim() : "";
}

/**
 * @param {object} body
 * @param {{ allowedColumns: Set<string>, defaultColumn: string }} options
 */
export function parseLookupFilters(body, { allowedColumns, defaultColumn }) {
  const raw =
    body.filters && typeof body.filters === "object" ? body.filters : {};
  const q = parseLookupQuery(body);
  const limit = parseLookupLimit(body);

  if (raw.autocomplete === true) {
    return { mode: "autocomplete", q, limit };
  }

  const search_column =
    raw.search_column != null && String(raw.search_column).trim() !== ""
      ? String(raw.search_column).trim()
      : defaultColumn;

  if (!allowedColumns.has(search_column)) {
    throw new Error(
      `filters.search_column must be one of: ${[...allowedColumns].join(", ")}.`
    );
  }

  return {
    mode: "search",
    q,
    limit,
    search_column,
    search_operator: normalizeSearchOperator(raw.search_operator),
  };
}
