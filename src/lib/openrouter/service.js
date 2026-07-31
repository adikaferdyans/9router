/**
 * OpenRouter API Service
 *
 * Reusable service layer for interacting with the OpenRouter API.
 * All methods are pure: they take an API key and return data, throwing on error.
 *
 * Documented endpoints used (https://openrouter.ai/docs):
 *   - GET /api/v1/models  — full model/provider catalog with pricing & capabilities
 *   - GET /api/v1/key     — API key info: limit, usage, is_free_tier (includes credit data)
 *
 * There is NO documented /api/v1/credits endpoint. Credit/usage info comes from
 * GET /api/v1/key's response fields (limit_remaining, usage, etc.). We do NOT
 * invent unsupported endpoints.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODELS_CACHE_TTL_MS = 60_000; // 1 minute — catalog is large; avoid hammering

// --- Simple in-memory cache for the models catalog (process-wide) ---
let _modelsCache = { value: null, expiresAt: 0 };

function invalidateModelsCache() {
  _modelsCache = { value: null, expiresAt: 0 };
}

/**
 * Build the standard OpenRouter auth headers for a given API key.
 * @param {string} apiKey - OpenRouter API key (sk-or-...)
 * @returns {object} Headers object with Authorization + OpenRouter metadata.
 */
function buildAuthHeaders(apiKey) {
  if (!apiKey) throw new Error("OpenRouter API key is required");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://endpoint-proxy.local",
    "X-Title": "Endpoint Proxy",
  };
}

/**
 * Wrapper around fetch that throws on non-ok responses with a useful message.
 * @private
 */
async function fetchOrThrow(url, apiKey) {
  const response = await fetch(url, { method: "GET", headers: buildAuthHeaders(apiKey) });
  if (!response.ok) {
    let detail;
    try {
      const body = await response.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = await response.text().catch(() => "");
    }
    const err = new Error(`OpenRouter API error ${response.status}: ${detail}`);
    err.status = response.status;
    err.url = url;
    throw err;
  }
  return response;
}

/**
 * Fetch the full model/provider catalog from OpenRouter.
 * Includes pricing (model-level, NOT per-provider), context_length, and supported_parameters.
 * The /models endpoint does not expose per-provider pricing breakdowns — pricing fields
 * are at the model level and apply across all providers serving that model.
 *
 * @param {string} apiKey - OpenRouter API key
 * @param {object} [opts] - Options
 * @param {boolean} [opts.useCache=true] - Use the short-lived in-memory cache.
 * @param {number} [opts.cacheTtlMs] - Override the cache TTL.
 * @returns {Promise<object[]>} Array of model objects from OpenRouter.
 */
export async function fetchModelCatalog(apiKey, opts = {}) {
  const { useCache = true, cacheTtlMs = MODELS_CACHE_TTL_MS } = opts;

  if (useCache && _modelsCache.value && _modelsCache.expiresAt > Date.now()) {
    return _modelsCache.value;
  }

  const response = await fetchOrThrow(`${OPENROUTER_BASE}/models`, apiKey);
  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : [];

  if (useCache) {
    _modelsCache = { value: models, expiresAt: Date.now() + cacheTtlMs };
  }
  return models;
}

/**
 * Transform a raw OpenRouter model entry into a normalized catalog item with
 * model-level pricing and capabilities. Pure function, no I/O.
 *
 * NOTE: OpenRouter's /models endpoint returns pricing at the MODEL level
 * (prompt/completion per-token in USD strings). It does NOT expose per-provider
 * pricing breakdowns. The pricing shown here is the model-level rate used across
 * all providers serving this model on OpenRouter.
 *
 * @param {object} model - Raw model entry from GET /api/v1/models
 * @returns {object} Normalized model descriptor.
 */
export function normalizeModelEntry(model) {
  if (!model) return null;
  return {
    id: model.id,
    name: model.name || model.id,
    description: model.description || "",
    contextLength: model.context_length || null,
    created: model.created || null,
    architecture: model.architecture || {},
    // Pricing: OpenRouter returns string dollar-per-token values ("0.0000015")
    pricing: {
      prompt: model.pricing?.prompt != null ? parseFloat(model.pricing.prompt) : null,
      completion: model.pricing?.completion != null ? parseFloat(model.pricing.completion) : null,
      request: model.pricing?.request != null ? parseFloat(model.pricing.request) : null,
      image: model.pricing?.image != null ? parseFloat(model.pricing.image) : null,
    },
    // Capabilities
    supportedParameters: model.supported_parameters || [],
    // Per-model provider routing: OpenRouter /models does not expose per-provider
    // pricing breakdowns. This field is reserved for future use if the API adds it.
    // For provider-level info, see the OpenRouter /model/{id} endpoint docs.
    providers: Array.isArray(model.providers)
      ? model.providers
      : model.top_provider
        ? [{ id: model.top_provider.id || model.top_provider.name, name: model.top_provider.name }]
        : [],
  };
}

/**
 * Fetch a normalized, enriched model catalog. This is the primary method for
 * "give me everything about every model, with pricing and capabilities".
 *
 * @param {string} apiKey - OpenRouter API key
 * @param {object} [opts] - Options
 * @param {string} [opts.search] - Case-insensitive substring filter on model id or name.
 * @param {number} [opts.limit] - Maximum number of models to return.
 * @param {boolean} [opts.useCache=true] - Use cached catalog when available.
 * @returns {Promise<{ models: object[], cached: boolean }>}
 */
export async function getModelCatalog(apiKey, opts = {}) {
  const { search, limit, useCache = true } = opts;
  const raw = await fetchModelCatalog(apiKey, { useCache });

  let models = raw.map(normalizeModelEntry).filter(Boolean);

  if (search) {
    const q = search.toLowerCase();
    models = models.filter(
      (m) => m.id?.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q),
    );
  }

  if (typeof limit === "number" && limit > 0) {
    models = models.slice(0, limit);
  }

  return { models, cached: useCache && _modelsCache.expiresAt > Date.now() };
}

/**
 * Fetch API key info (credits, usage, limits) from the documented GET /api/v1/key endpoint.
 *
 * The response includes:
 *   - label: API key label
 *   - limit / limit_remaining: per-key credit cap and remaining
 *   - usage, usage_daily, usage_weekly, usage_monthly: credit usage counters
 *   - is_free_tier: whether the account has ever purchased credits
 *   - rate_limit: (deprecated in OR docs; included for completeness)
 *
 * @param {string} apiKey - OpenRouter API key
 * @returns {Promise<object>} Key info object (unwrapped from { data: {...} })
 */
export async function getKeyInfo(apiKey) {
  const response = await fetchOrThrow(`${OPENROUTER_BASE}/key`, apiKey);
  const data = await response.json();
  // OpenRouter wraps key info in { data: { ... } }
  return data?.data || data || {};
}

// ─── Provider Routing Configuration ──────────────────────────────────────────

// All valid fields in the OpenRouter `provider` routing object.
// See: https://openrouter.ai/docs/features/provider-routing
const VALID_ROUTING_FIELDS = new Set([
  "order",            // string[] — preferred provider order
  "allow_fallbacks",  // boolean
  "require_parameters", // boolean
  "data_collection",  // "allow" | "deny"
  "ignore",           // string[] — providers to skip
  "only",             // string[] — only these providers
  "quantizations",    // string[]
  "sort",             // string | object
  "max_price",        // object
  "preferred_min_throughput", // number | object
  "preferred_max_latency",    // number | object
  "zdr",              // boolean
  "enforce_distillable_text", // boolean
]);

/**
 * Normalize and validate a provider routing configuration object.
 * Strips unknown fields and coerces types. Returns a clean routing object or null.
 *
 * @param {*} input - Raw routing config (from providerSpecificData or API body).
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

  // Drop any remaining unknown fields silently
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Check if a given field name is a valid OpenRouter provider routing field.
 * @param {string} field
 * @returns {boolean}
 */
export function isValidRoutingField(field) {
  return VALID_ROUTING_FIELDS.has(field);
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

// Exported for test access
export { invalidateModelsCache, VALID_ROUTING_FIELDS, OPENROUTER_BASE };
