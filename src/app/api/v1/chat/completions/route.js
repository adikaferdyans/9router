import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getSettings } from "@/lib/localDb";
import { setChineseFilterEnabled } from "open-sse/utils/chineseFilter";

let initialized = false;

/**
 * Initialize translators and Chinese character filter once per process.
 * Called before the first chat request. Reads settings from DB via the
 * app's own getSettings() (multi-driver, DATA_DIR-aware) so the Chinese
 * character filter starts with the correct toggle state regardless of when
 * initializeApp() runs (or whether it runs before the first API request).
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();

    // Sync Chinese character filter state from persistent settings so it's active
    // even if initializeApp() hasn't run yet in this webpack bundle.
    try {
      const settings = await getSettings();
      setChineseFilterEnabled(Boolean(settings.chineseFilterEnabled));
    } catch (e) {
      console.warn("[ChineseFilter] Failed to init filter from settings:", e.message);
    }

    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {  
  // Fallback to local handling
  await ensureInitialized();
  
  return await handleChat(request);
}

