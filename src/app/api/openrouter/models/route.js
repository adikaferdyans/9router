import { NextResponse } from "next/server";
import { getModelCatalog } from "@/lib/openrouter/service";
import { getProviderConnections } from "@/models";

export const dynamic = "force-dynamic";

/**
 * GET /api/openrouter/models
 *
 * Returns the OpenRouter model/provider catalog with pricing and capabilities.
 * Uses the first active OpenRouter connection's API key to fetch live data.
 *
 * Query params:
 *   - search: case-insensitive substring filter on model id or name
 *   - limit:  maximum number of models to return
 *   - nocache: if "1", bypass the in-memory cache
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const limitStr = searchParams.get("limit");
    const noCache = searchParams.get("nocache") === "1";
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    // Find an active openrouter connection to use its API key
    const connections = await getProviderConnections({ provider: "openrouter" });
    const activeConn = connections.find((c) => c.isActive !== false) || connections[0];

    if (!activeConn) {
      return NextResponse.json(
        { error: "No OpenRouter connection found. Add an OpenRouter provider connection first." },
        { status: 404 },
      );
    }

    const apiKey = activeConn.apiKey;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenRouter connection has no API key configured" },
        { status: 400 },
      );
    }

    const { models, cached } = await getModelCatalog(apiKey, {
      search,
      limit,
      useCache: !noCache,
    });

    return NextResponse.json({
      provider: "openrouter",
      connectionId: activeConn.id,
      models,
      cached,
      count: models.length,
    });
  } catch (error) {
    const status = error.status || 500;
    console.log("OpenRouter models catalog error:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to fetch OpenRouter model catalog" },
      { status },
    );
  }
}
