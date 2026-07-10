/**
 * Chinese Character Filter
 *
 * Strips Chinese characters from AI response text output.
 *
 * Architecture:
 * - Pure module: no DB access, no side effects at import time.
 * - Runtime state is held on globalThis, NOT a module-level `let` variable.
 *   In Next.js, each API route handler can be bundled in its own module scope,
 *   so a module-level `let enabled` would give multiple independent copies.
 *   globalThis is shared across ALL bundles in the same Node.js process,
 *   ensuring the settings PATCH handler and the chat handler always read/write
 *   the same flag.
 * - filterChinese() is synchronous — streaming callers use it inline.
 */

const CHINESE_PATTERN = /[\u2e80-\u2eff\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/g;

const ENABLED_KEY = "__chineseFilterEnabled";

/**
 * Filter out Chinese characters from a string.
 *
 * @param {string} str - Input text to filter.
 * @returns {string} The input with Chinese characters removed, or the original
 *   value unchanged when the filter is disabled or the input is not a non-empty
 *   string. Always synchronous.
 */
export function filterChinese(str) {
  if (!globalThis[ENABLED_KEY] || !str || typeof str !== "string") return str;
  const filtered = str.replace(CHINESE_PATTERN, "");
  return filtered.length === str.length ? str : filtered;
}

/**
 * Enable or disable the Chinese character filter at runtime.
 *
 * Called from initializeApp (on startup) and the settings PATCH handler (on
 * toggle). Idempotent.
 *
 * Uses globalThis so that all Next.js bundles in the same process read/write
 * the same state, regardless of module caching boundaries.
 *
 * @param {boolean} value - True to enable filtering, false to disable.
 */
export function setChineseFilterEnabled(value) {
  globalThis[ENABLED_KEY] = Boolean(value);
}
