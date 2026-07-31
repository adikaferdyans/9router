// Unit tests for OpenRouter provider routing — normalize, read, and apply to request body.
import { describe, it, expect } from "vitest";
import {
  normalizeRoutingConfig,
  readRoutingConfig,
  applyRoutingToBody,
} from "../../open-sse/services/openrouterRouting.js";

describe("normalizeRoutingConfig", () => {
  it("returns null for empty/null/non-object input", () => {
    expect(normalizeRoutingConfig(null)).toBeNull();
    expect(normalizeRoutingConfig(undefined)).toBeNull();
    expect(normalizeRoutingConfig("string")).toBeNull();
    expect(normalizeRoutingConfig([])).toBeNull();
    expect(normalizeRoutingConfig({})).toBeNull();
  });

  it("preserves string array fields (order, ignore, only, quantizations)", () => {
    const result = normalizeRoutingConfig({
      order: ["anthropic", "openai"],
      ignore: ["google"],
      only: ["aws"],
      quantizations: ["int4", "int8"],
    });
    expect(result).toEqual({
      order: ["anthropic", "openai"],
      ignore: ["google"],
      only: ["aws"],
      quantizations: ["int4", "int8"],
    });
  });

  it("filters empty/blank strings from arrays", () => {
    const result = normalizeRoutingConfig({
      order: ["anthropic", "", "  ", "openai"],
    });
    expect(result.order).toEqual(["anthropic", "openai"]);
  });

  it("preserves boolean fields", () => {
    const result = normalizeRoutingConfig({
      allow_fallbacks: false,
      require_parameters: true,
      zdr: true,
      enforce_distillable_text: false,
    });
    expect(result).toEqual({
      allow_fallbacks: false,
      require_parameters: true,
      zdr: true,
      enforce_distillable_text: false,
    });
  });

  it("preserves data_collection enum (allow/deny)", () => {
    expect(normalizeRoutingConfig({ data_collection: "allow" }).data_collection).toBe("allow");
    expect(normalizeRoutingConfig({ data_collection: "deny" }).data_collection).toBe("deny");
    expect(normalizeRoutingConfig({ data_collection: "other" })).toBeNull();
  });

  it("preserves sort as string or object", () => {
    expect(normalizeRoutingConfig({ sort: "price" }).sort).toBe("price");
    expect(normalizeRoutingConfig({ sort: { by: "throughput" } }).sort).toEqual({ by: "throughput" });
    expect(normalizeRoutingConfig({ sort: "" })).toBeNull();
  });

  it("preserves max_price object with numeric prompt/completion", () => {
    const result = normalizeRoutingConfig({
      max_price: { prompt: 0.001, completion: 0.002 },
    });
    expect(result.max_price).toEqual({ prompt: 0.001, completion: 0.002 });
  });

  it("drops unknown fields silently", () => {
    const result = normalizeRoutingConfig({
      order: ["openai"],
      bogus_field: "should be removed",
      another_unknown: 42,
    });
    expect(result).toEqual({ order: ["openai"] });
    expect(result).not.toHaveProperty("bogus_field");
    expect(result).not.toHaveProperty("another_unknown");
  });

  it("preserves performance thresholds as number or percentile object", () => {
    const result = normalizeRoutingConfig({
      preferred_min_throughput: 100,
      preferred_max_latency: { p50: 1.5, p99: 5.0 },
    });
    expect(result.preferred_min_throughput).toBe(100);
    expect(result.preferred_max_latency).toEqual({ p50: 1.5, p99: 5.0 });
  });
});

describe("readRoutingConfig", () => {
  it("reads openrouterRouting key from providerSpecificData", () => {
    const psd = { openrouterRouting: { order: ["anthropic"] } };
    expect(readRoutingConfig(psd)).toEqual({ order: ["anthropic"] });
  });

  it("falls back to routing key", () => {
    const psd = { routing: { only: ["openai"] } };
    expect(readRoutingConfig(psd)).toEqual({ only: ["openai"] });
  });

  it("returns null when no routing config exists", () => {
    expect(readRoutingConfig({})).toBeNull();
    expect(readRoutingConfig(null)).toBeNull();
    expect(readRoutingConfig(undefined)).toBeNull();
  });

  it("normalizes the config before returning", () => {
    const psd = {
      openrouterRouting: {
        order: ["anthropic", ""],
        unknown_field: "dropped",
      },
    };
    expect(readRoutingConfig(psd)).toEqual({ order: ["anthropic"] });
  });
});

describe("applyRoutingToBody", () => {
  it("injects routing config into body.provider for openrouter", () => {
    const body = { model: "openai/gpt-4o", messages: [] };
    const credentials = {
      providerSpecificData: { openrouterRouting: { order: ["anthropic"] } },
    };
    const result = applyRoutingToBody(body, "openrouter", credentials);
    expect(result.provider).toEqual({ order: ["anthropic"] });
  });

  it("does NOT override existing body.provider (client override wins)", () => {
    const body = { model: "openai/gpt-4o", provider: { only: ["google"] } };
    const credentials = {
      providerSpecificData: { openrouterRouting: { order: ["anthropic"] } },
    };
    const result = applyRoutingToBody(body, "openrouter", credentials);
    expect(result.provider).toEqual({ only: ["google"] });
  });

  it("is a no-op for non-openrouter providers", () => {
    const body = { model: "gpt-4o", messages: [] };
    const credentials = {
      providerSpecificData: { openrouterRouting: { order: ["anthropic"] } },
    };
    const result = applyRoutingToBody(body, "openai", credentials);
    expect(result.provider).toBeUndefined();
  });

  it("is a no-op when no routing config exists", () => {
    const body = { model: "openai/gpt-4o", messages: [] };
    const credentials = { providerSpecificData: {} };
    const result = applyRoutingToBody(body, "openrouter", credentials);
    expect(result.provider).toBeUndefined();
  });

  it("is a no-op when credentials is null/undefined", () => {
    const body = { model: "openai/gpt-4o", messages: [] };
    expect(applyRoutingToBody(body, "openrouter", null).provider).toBeUndefined();
    expect(applyRoutingToBody(body, "openrouter", undefined).provider).toBeUndefined();
  });

  it("is a no-op when body is null/undefined", () => {
    expect(applyRoutingToBody(null, "openrouter", {})).toBeNull();
    expect(applyRoutingToBody(undefined, "openrouter", {})).toBeUndefined();
  });

  it("injects reasoning_effort when openrouterReasoningEnabled is true", () => {
    const body = { model: "anthropic/claude-3.5-sonnet", messages: [] };
    const credentials = {
      providerSpecificData: {
        openrouterReasoningEnabled: true,
        openrouterReasoningEffort: "high",
      },
    };
    const result = applyRoutingToBody(body, "openrouter", credentials);
    expect(result.reasoning_effort).toBe("high");
  });

  it("does NOT inject reasoning_effort when client already set it", () => {
    const body = { model: "anthropic/claude-3.5-sonnet", messages: [], reasoning_effort: "low" };
    const credentials = {
      providerSpecificData: {
        openrouterReasoningEnabled: true,
        openrouterReasoningEffort: "high",
      },
    };
    const result = applyRoutingToBody(body, "openrouter", credentials);
    expect(result.reasoning_effort).toBe("low");
  });

  it("does NOT inject reasoning_effort when openrouterReasoningEnabled is false", () => {
    const body = { model: "anthropic/claude-3.5-sonnet", messages: [] };
    const credentials = {
      providerSpecificData: {
        openrouterReasoningEnabled: false,
        openrouterReasoningEffort: "high",
      },
    };
    const result = applyRoutingToBody(body, "openrouter", credentials);
    expect(result.reasoning_effort).toBeUndefined();
  });

  it("does NOT inject reasoning_effort when effort is none", () => {
    const body = { model: "anthropic/claude-3.5-sonnet", messages: [] };
    const credentials = {
      providerSpecificData: {
        openrouterReasoningEnabled: true,
        openrouterReasoningEffort: "none",
      },
    };
    const result = applyRoutingToBody(body, "openrouter", credentials);
    expect(result.reasoning_effort).toBeUndefined();
  });

  it("applies both routing config and reasoning_effort together", () => {
    const body = { model: "anthropic/claude-3.5-sonnet", messages: [] };
    const credentials = {
      providerSpecificData: {
        openrouterRouting: { order: ["anthropic"] },
        openrouterReasoningEnabled: true,
        openrouterReasoningEffort: "medium",
      },
    };
    const result = applyRoutingToBody(body, "openrouter", credentials);
    expect(result.provider).toEqual({ order: ["anthropic"] });
    expect(result.reasoning_effort).toBe("medium");
  });

  it("client provider override still wins over stored routing", () => {
    const body = { model: "openai/gpt-4o", messages: [], provider: { only: ["openai"] } };
    const credentials = {
      providerSpecificData: {
        openrouterRouting: { order: ["anthropic"] },
        openrouterReasoningEnabled: true,
        openrouterReasoningEffort: "high",
      },
    };
    const result = applyRoutingToBody(body, "openrouter", credentials);
    // Client provider override wins
    expect(result.provider).toEqual({ only: ["openai"] });
    // But reasoning_effort is still injected (client didn't set it)
    expect(result.reasoning_effort).toBe("high");
  });
});
