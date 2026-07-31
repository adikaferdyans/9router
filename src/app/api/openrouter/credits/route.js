import { NextResponse } from "next/server";
import { getKeyInfo } from "@/lib/openrouter/service";
import { getProviderConnections, getProviderConnectionById } from "@/models";

export const dynamic = "force-dynamic";

/**
 * GET /api/openrouter/credits
 *
 * Returns API key info from OpenRouter's documented GET /api/v1/key endpoint.
 * This includes credit limits, usage counters, and free-tier status.
 *
 * There is NO documented /api/v1/credits endpoint on OpenRouter. All credit/usage
 * information comes from the /key response fields:
 *   - limit, limit_remaining: per-key credit cap
 *   - usage, usage_daily, usage_weekly, usage_monthly
 *   - is_free_tier
 *
 * Query params:
 *   - connectionId: specific connection to use (defaults to first active openrouter conn)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");

    let connection;
    if (connectionId) {
      connection = await getProviderConnectionById(connectionId);
      if (!connection || connection.provider !== "openrouter") {
        return NextResponse.json(
          { error: "Connection not found or not an OpenRouter connection" },
          { status: 404 },
        );
      }
    } else {
      const connections = await getProviderConnections({ provider: "openrouter" });
      connection = connections.find((c) => c.isActive !== false) || connections[0];
    }

    if (!connection) {
      return NextResponse.json(
        { error: "No OpenRouter connection found. Add an OpenRouter provider connection first." },
        { status: 404 },
      );
    }

    const apiKey = connection.apiKey;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenRouter connection has no API key configured" },
        { status: 400 },
      );
    }

    const keyInfo = await getKeyInfo(apiKey);

    return NextResponse.json({
      provider: "openrouter",
      connectionId: connection.id,
      keyInfo,
      // Normalize credit fields for convenience — all from the documented /key response
      credits: {
        limit: keyInfo.limit ?? null,
        limitRemaining: keyInfo.limit_remaining ?? null,
        limitReset: keyInfo.limit_reset ?? null,
        usage: keyInfo.usage ?? null,
        usageDaily: keyInfo.usage_daily ?? null,
        usageWeekly: keyInfo.usage_weekly ?? null,
        usageMonthly: keyInfo.usage_monthly ?? null,
        isFreeTier: keyInfo.is_free_tier ?? null,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    console.log("OpenRouter key info error:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to fetch OpenRouter key info" },
      { status },
    );
  }
}
