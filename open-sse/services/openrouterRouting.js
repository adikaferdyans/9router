/**
 * OpenRouter provider routing — request-body injection.
 *
 * This module lives in the open-sse engine (not src/) because it runs inside
 * DefaultExecutor.transformRequest, which is part of the provider-agnostic
 * routing engine. The open-sse engine is designed to be standalone and must
 * NOT import from @/ (src/), so the routing logic is self-contained here.
 *
 * The src/lib/openrouter/service.js module has its own copy of the same
 * normalizeRoutingConfig logic for the API route layer; the two are kept in
 * sync. This duplication is intentional to preserve the open-sse / src boundary.
 *
 * See: https://openrouter.ai/docs/features/provider-routing
 */

// All valid fields in the OpenRouter `provider` routing object.
const VALID_ROUTING_FIELDS = new Set([
  "order",
  "allow_fallbacks",
  "require_parameters",
  "data_collection",
  "ignore",
  "only",
  "quantizations",
  "sort",
  "max_price",
  "preferred_min_throughput",
  "preferred_max_latency",
  "zdr",
  "enforce_distillable_text",
]);

/**
 * Normalize and validate a provider routing configuration object.
 * Strips unknown fields and coerces types. Returns a clean routing object or null.
 *
 * @param {*} input - Raw routing config.
 * @returns {object|null} Normalized routing config, or null if empty/invalid.
 */
export function normalizeRoutingConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const result = {};

  // String arrays
  for (const field of ["order", "ignore", "only", "quantizations"]) {
    if (Array.isArray(input[field])) {
      const cleaned = input[field]
        .map((v) => (typeof v === "string" ? v.trim() : String(v)))
        .filter(Boolean);
      if (cleaned.length > 0) result[field] = cleaned;
    }
  }

  // Booleans
  for (const field of ["allow_fallbacks", "require_parameters", "zdr", "enforce_distillable_text"]) {
    if (typeof input[field] === "boolean") {
      result[field] = input[field];
    }
  }

  // Enum: data_collection
  if (input.data_collection === "allow" || input.data_collection === "deny") {
    result.data_collection = input.data_collection;
  }

  // sort: string or object
  if (typeof input.sort === "string" && input.sort.trim()) {
    result.sort = input.sort.trim();
  } else if (input.sort && typeof input.sort === "object" && !Array.isArray(input.sort)) {
    const s = {};
    if (typeof input.sort.by === "string") s.by = input.sort.by.trim();
    if (s.by) result.sort = s;
  }

  // max_price: object { prompt?, completion? }
  if (input.max_price && typeof input.max_price === "object" && !Array.isArray(input.max_price)) {
    const mp = {};
    if (typeof input.max_price.prompt === "number") mp.prompt = input.max_price.prompt;
    if (typeof input.max_price.completion === "number") mp.completion = input.max_price.completion;
    if (Object.keys(mp).length > 0) result.max_price = mp;
  }

  // Performance thresholds: number or object with percentile cutoffs
  for (const field of ["preferred_min_throughput", "preferred_max_latency"]) {
    const val = input[field];
    if (typeof val === "number") {
      result[field] = val;
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      const cleaned = {};
      for (const pct of ["p50", "p75", "p90", "p99"]) {
        if (typeof val[pct] === "number") cleaned[pct] = val[pct];
      }
      if (Object.keys(cleaned).length > 0) result[field] = cleaned;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Read the OpenRouter provider routing config stored on a connection's
 * providerSpecificData. Returns a normalized routing object or null.
 *
 * @param {object} providerSpecificData - The connection's providerSpecificData.
 * @returns {object|null}
 */
export function readRoutingConfig(providerSpecificData) {
  if (!providerSpecificData) return null;
  const raw = providerSpecificData.openrouterRouting || providerSpecificData.routing;
  return normalizeRoutingConfig(raw);
}

/**
 * Apply stored OpenRouter provider routing config to a chat request body.
 * Mutates the body in-place by setting body.provider if:
 *   - the body doesn't already have a provider field (client override wins)
 *   - the provider is "openrouter"
 *   - a non-null routing config exists on the credentials
 *
 * @param {object} body - Chat request body (mutated in-place).
 * @param {string} provider - The provider id (e.g. "openrouter").
 * @param {object} credentials - Connection credentials with providerSpecificData.
 * @returns {object} The (possibly mutated) body.
 */
export function applyRoutingToBody(body, provider, credentials) {
  if (!body || provider !== "openrouter") return body;
  if (body.provider !== undefined) return body; // client override wins

  const routing = readRoutingConfig(credentials?.providerSpecificData);
  if (routing) {
    body.provider = routing;
  }
  return body;
}
