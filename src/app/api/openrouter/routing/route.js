import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/models";
import { normalizeRoutingConfig, readRoutingConfig, isValidRoutingField } from "@/lib/openrouter/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/openrouter/routing?connectionId=xxx
 *
 * Returns the current OpenRouter provider routing config stored on a connection's
 * providerSpecificData.openrouterRouting.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");

    if (!connectionId) {
      return NextResponse.json(
        { error: "connectionId query parameter is required" },
        { status: 400 },
      );
    }

    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (connection.provider !== "openrouter") {
      return NextResponse.json(
        { error: "Connection is not an OpenRouter connection" },
        { status: 400 },
      );
    }

    const routing = readRoutingConfig(connection.providerSpecificData);

    return NextResponse.json({
      connectionId: connection.id,
      routing: routing || {},
      active: !!routing,
    });
  } catch (error) {
    console.log("OpenRouter routing GET error:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch routing config" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/openrouter/routing?connectionId=xxx
 *
 * Persist a provider routing configuration to the connection's
 * providerSpecificData.openrouterRouting. The config is normalized and validated.
 *
 * Pass an empty object {} or { routing: null } to clear the routing config.
 *
 * Body: { routing: { ... } }  OR  the routing object directly.
 */
export async function PUT(request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");

    if (!connectionId) {
      return NextResponse.json(
        { error: "connectionId query parameter is required" },
        { status: 400 },
      );
    }

    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (connection.provider !== "openrouter") {
      return NextResponse.json(
        { error: "Connection is not an OpenRouter connection" },
        { status: 400 },
      );
    }

    const body = await request.json();
    // Accept either { routing: {...} } or the routing object directly
    const rawRouting = body?.routing !== undefined ? body.routing : body;

    // Empty/null/{} clears the routing config
    if (
      rawRouting === null ||
      (typeof rawRouting === "object" &&
        !Array.isArray(rawRouting) &&
        Object.keys(rawRouting).length === 0)
    ) {
      const existing = connection.providerSpecificData || {};
      const cleared = { ...existing };
      delete cleared.openrouterRouting;
      delete cleared.routing;
      await updateProviderConnection(connectionId, { providerSpecificData: cleared });

      return NextResponse.json({
        connectionId,
        routing: {},
        active: false,
        message: "Routing config cleared",
      });
    }

    // Validate field names before persisting
    if (typeof rawRouting !== "object" || Array.isArray(rawRouting)) {
      return NextResponse.json(
        { error: "Routing config must be an object" },
        { status: 400 },
      );
    }

    for (const field of Object.keys(rawRouting)) {
      if (!isValidRoutingField(field)) {
        return NextResponse.json(
          { error: `Unknown provider routing field: "${field}"` },
          { status: 400 },
        );
      }
    }

    const normalized = normalizeRoutingConfig(rawRouting);
    if (!normalized) {
      return NextResponse.json(
        { error: "Routing config is empty after normalization (all fields invalid)" },
        { status: 400 },
      );
    }

    // Merge into existing providerSpecificData (preserve other fields)
    const existing = connection.providerSpecificData || {};
    await updateProviderConnection(connectionId, {
      providerSpecificData: {
        ...existing,
        openrouterRouting: normalized,
      },
    });

    return NextResponse.json({
      connectionId,
      routing: normalized,
      active: true,
    });
  } catch (error) {
    console.log("OpenRouter routing PUT error:", error.message);
    return NextResponse.json(
      { error: "Failed to update routing config" },
      { status: 500 },
    );
  }
}
