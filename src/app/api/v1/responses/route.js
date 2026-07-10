import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getSettings } from "@/lib/localDb";
import { setChineseFilterEnabled } from "open-sse/utils/chineseFilter";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    try {
      const settings = await getSettings();
      setChineseFilterEnabled(Boolean(settings.chineseFilterEnabled));
    } catch (e) {
      console.warn("[ChineseFilter] Failed to init filter from settings:", e.message);
    }
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
export async function POST(request) {
  await ensureInitialized();
  return await handleChat(request);
}
