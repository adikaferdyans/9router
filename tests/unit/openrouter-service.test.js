// Unit tests for OpenRouter service layer — model catalog normalization.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch for catalog tests
const fetchMock = vi.fn();
global.fetch = fetchMock;

const { normalizeModelEntry, getModelCatalog, invalidateModelsCache, normalizeRoutingConfig, isValidRoutingField } =
  await import("../../src/lib/openrouter/service.js");

beforeEach(() => {
  fetchMock.mockReset();
  invalidateModelsCache();
});

describe("normalizeModelEntry", () => {
  it("normalizes a raw OpenRouter model entry", () => {
    const raw = {
      id: "anthropic/claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet",
      description: "Latest Claude model",
      context_length: 200000,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools", "temperature"],
      architecture: { modality: "text" },
    };
    const result = normalizeModelEntry(raw);
    expect(result.id).toBe("anthropic/claude-3.5-sonnet");
    expect(result.name).toBe("Claude 3.5 Sonnet");
    expect(result.contextLength).toBe(200000);
    expect(result.pricing.prompt).toBe(0.000003);
    expect(result.pricing.completion).toBe(0.000015);
    expect(result.supportedParameters).toEqual(["tools", "temperature"]);
  });

  it("handles null/undefined input", () => {
    expect(normalizeModelEntry(null)).toBeNull();
    expect(normalizeModelEntry(undefined)).toBeNull();
  });

  it("handles missing pricing fields gracefully", () => {
    const result = normalizeModelEntry({ id: "test/model", name: "Test" });
    expect(result.pricing.prompt).toBeNull();
    expect(result.pricing.completion).toBeNull();
    expect(result.pricing.request).toBeNull();
    expect(result.pricing.image).toBeNull();
  });

  it("falls back to id when name is missing", () => {
    const result = normalizeModelEntry({ id: "test/model" });
    expect(result.name).toBe("test/model");
  });
});

describe("getModelCatalog", () => {
  it("fetches and normalizes models from the API", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "openai/gpt-4o", name: "GPT-4o", context_length: 128000, pricing: { prompt: "0.000005", completion: "0.000015" } },
          { id: "anthropic/claude-3", name: "Claude 3", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" } },
        ],
      }),
    });

    const { models, cached } = await getModelCatalog("sk-or-test", { useCache: false });
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("openai/gpt-4o");
    expect(models[0].pricing.prompt).toBe(0.000005);
    expect(cached).toBe(false);
  });

  it("applies search filter on model id and name", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "openai/gpt-4o", name: "GPT-4o" },
          { id: "anthropic/claude-3", name: "Claude 3" },
        ],
      }),
    });

    const { models } = await getModelCatalog("sk-or-test", { search: "gpt", useCache: false });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("openai/gpt-4o");
  });

  it("applies limit to results", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "a" }, { id: "b" }, { id: "c" },
        ],
      }),
    });

    const { models } = await getModelCatalog("sk-or-test", { limit: 2, useCache: false });
    expect(models).toHaveLength(2);
  });

  it("throws on API error with status code", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid API key" } }),
      text: async () => "",
    });

    let error = null;
    try {
      await getModelCatalog("bad-key", { useCache: false });
    } catch (e) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(error.status).toBe(401);
    expect(error.message).toContain("401");
  });

  it("serves from cache on second call", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "cached-model", name: "Cached" }] }),
    });

    const first = await getModelCatalog("sk-or-test", { useCache: true });
    expect(first.cached).toBe(true); // cache was just populated
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await getModelCatalog("sk-or-test", { useCache: true });
    expect(second.models[0].id).toBe("cached-model");
    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1 — served from cache
  });
});

describe("normalizeRoutingConfig (service layer)", () => {
  it("matches open-sse engine behavior", () => {
    const result = normalizeRoutingConfig({ order: ["openai"], allow_fallbacks: false });
    expect(result).toEqual({ order: ["openai"], allow_fallbacks: false });
  });

  it("returns null for empty input", () => {
    expect(normalizeRoutingConfig({})).toBeNull();
    expect(normalizeRoutingConfig(null)).toBeNull();
  });
});

describe("isValidRoutingField", () => {
  it("returns true for valid routing fields", () => {
    expect(isValidRoutingField("order")).toBe(true);
    expect(isValidRoutingField("allow_fallbacks")).toBe(true);
    expect(isValidRoutingField("data_collection")).toBe(true);
    expect(isValidRoutingField("max_price")).toBe(true);
    expect(isValidRoutingField("only")).toBe(true);
  });

  it("returns false for invalid fields", () => {
    expect(isValidRoutingField("bogus")).toBe(false);
    expect(isValidRoutingField("")).toBe(false);
    expect(isValidRoutingField("ORDER")).toBe(false); // case-sensitive
  });
});
