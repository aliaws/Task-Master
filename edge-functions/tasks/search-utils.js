const SEARCH_OPERATORS = new Set(["starts_with", "contains", "ends_with"]);

export function normalizeSearchOperator(mode) {
  if (mode == null || mode === "") return "contains";

  const key = String(mode).trim().toLowerCase().replace(/-/g, "_");
  const aliases = {
    startswith: "starts_with",
    stars_with: "starts_with",
    endswith: "ends_with",
  };

  const normalized = aliases[key] ?? key;
  if (!SEARCH_OPERATORS.has(normalized)) {
    throw new Error(
      'filters.search_operator must be "starts_with", "contains", or "ends_with".'
    );
  }
  return normalized;
}

export function escapeLikePattern(value) {
  return String(value).replace(/[%_\\]/g, "\\$&");
}

export function buildIlikePattern(term, operator) {
  const escaped = escapeLikePattern(term);
  if (operator === "starts_with") return `${escaped}%`;
  if (operator === "ends_with") return `%${escaped}`;
  return `%${escaped}%`;
}
