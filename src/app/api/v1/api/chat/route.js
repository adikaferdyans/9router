import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";
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

export async function POST(request) {
  await ensureInitialized();
  
  const clonedReq = request.clone();
  let modelName = "llama3.2";
  try {
    const body = await clonedReq.json();
    modelName = body.model || "llama3.2";
  } catch {}

  const response = await handleChat(request);
  return transformToOllama(response, modelName);
}

