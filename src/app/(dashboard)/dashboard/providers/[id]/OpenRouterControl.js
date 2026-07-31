"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Button, Badge, Toggle, Select } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

/**
 * OpenRouterControl — ergonomic OpenRouter-specific control section.
 *
 * Renders ONLY on the OpenRouter provider detail page. Provides:
 *  - Model selection (from live OpenRouter /models endpoint, with pricing display)
 *  - Provider mode (auto / preferred / strict) — persisted per-connection
 *  - Provider order/selection (which upstream providers OpenRouter may route to)
 *  - Reasoning settings when the selected model supports it
 *  - Pricing display fetched from a backend endpoint
 *
 * Routing config is persisted to the connection's providerSpecificData.openrouterRouting
 * via the /api/openrouter/routing endpoint. Selected model and reasoning settings are
 * persisted to the connection via PUT /api/providers/[id].
 *
 * Client body overrides always win (enforced by the backend applyRoutingToBody logic).
 */

const MODES = [
  { value: "auto", label: "Auto", hint: "OpenRouter picks the best provider" },
  { value: "preferred", label: "Preferred", hint: "Prefer selected providers, fall back if down" },
  { value: "strict", label: "Strict", hint: "Only use selected providers — no fallback" },
];
const REASONING_EFFORTS = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// A handful of well-known OpenRouter upstream providers for the selector.
// This is a UX aid, not an exhaustive list — OpenRouter's catalog is dynamic.
const KNOWN_UPSTREAM_PROVIDERS = [
  "OpenAI", "Anthropic", "Google", "DeepSeek", "Qwen", "Meta",
  "Mistral", "xAI", "Cohere", "Nous Research", "Perplexity",
  "Together", "Fireworks", "Groq", "Hyperbolic", "Infermatic",
];

function formatPrice(perMillion) {
  const n = Number(perMillion);
  if (!Number.isFinite(n) || n === 0) return n === 0 ? "Free" : "—";
  if (n < 0.01) return `$${n.toFixed(4)}/M`;
  return `$${n.toFixed(2)}/M`;
}

// ── Routing config ↔ UI preference mapping ─────────────────────────────────

/**
 * Convert OpenRouter routing config (order/only/allow_fallbacks) into
 * UI preferences { mode, preferredProviders, providerOrder }.
 */
function routingToPrefs(routing) {
  if (!routing || typeof routing !== "object") {
    return { mode: "auto", preferredProviders: [], providerOrder: [] };
  }
  if (routing.only && Array.isArray(routing.only) && routing.only.length > 0) {
    return {
      mode: "strict",
      preferredProviders: routing.only,
      providerOrder: routing.only,
    };
  }
  if (routing.order && Array.isArray(routing.order) && routing.order.length > 0) {
    return {
      mode: routing.allow_fallbacks === false ? "strict" : "preferred",
      preferredProviders: routing.order,
      providerOrder: routing.order,
    };
  }
  return { mode: "auto", preferredProviders: [], providerOrder: [] };
}

/**
 * Convert UI preferences into a routing config object for the backend.
 * Returns null for "auto" mode (no routing config needed).
 */
function prefsToRouting(mode, preferredProviders) {
  if (mode === "auto" || !preferredProviders.length) return null;
  if (mode === "strict") {
    return { only: [...preferredProviders], allow_fallbacks: false };
  }
  // preferred
  return { order: [...preferredProviders], allow_fallbacks: true };
}

export default function OpenRouterControl({ providerId, connections }) {
  const [routingPrefs, setRoutingPrefs] = useState(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState("none");
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [connectionId, setConnectionId] = useState(null);

  // Only render for openrouter
  const isOpenRouter = providerId === "openrouter";

  // Find the active OpenRouter connection
  const activeConnection = (connections || []).find(
    (c) => c.provider === "openrouter" && c.isActive !== false
  );

  // Sync connectionId when connections change
  useEffect(() => {
    if (activeConnection?.id) {
      setConnectionId(activeConnection.id);
    }
  }, [activeConnection?.id]);

  // Load persisted routing + model/reasoning from the connection
  const loadPrefs = useCallback(async () => {
    const connId = activeConnection?.id;
    if (!connId) {
      // No connection yet — show defaults
      setRoutingPrefs({ mode: "auto", preferredProviders: [], providerOrder: [] });
      setSelectedModel("");
      setReasoningEnabled(true);
      setReasoningEffort("none");
      return;
    }

    try {
      // Load routing config from /api/openrouter/routing
      const routingRes = await fetch(
        `/api/openrouter/routing?connectionId=${encodeURIComponent(connId)}`,
        { cache: "no-store" }
      );
      const routingData = routingRes.ok ? await routingRes.json() : {};
      const routing = routingData.routing || {};
      setRoutingPrefs(routingToPrefs(routing));

      // Load model/reasoning from connection's providerSpecificData
      const connRes = await fetch(`/api/providers/${connId}`, { cache: "no-store" });
      const connData = connRes.ok ? await connRes.json() : {};
      const psd = connData.connection?.providerSpecificData || {};
      setSelectedModel(psd.openrouterSelectedModel || activeConnection?.defaultModel || "");
      setReasoningEnabled(psd.openrouterReasoningEnabled !== false);
      setReasoningEffort(psd.openrouterReasoningEffort || "none");
    } catch {
      // Fail silently — defaults will be used
      setRoutingPrefs({ mode: "auto", preferredProviders: [], providerOrder: [] });
      setSelectedModel("");
      setReasoningEnabled(true);
      setReasoningEffort("none");
    }
  }, [activeConnection?.id, activeConnection?.defaultModel]);

  // Fetch live models from the OpenRouter backend catalog (/api/openrouter/models).
  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError("");
    try {
      const res = await fetch("/api/openrouter/models", { cache: "no-store" });
      if (!res.ok) {
        setModelsError("Failed to load OpenRouter models");
        return;
      }
      const data = await res.json();
      setModels(Array.isArray(data.models) ? data.models : []);
      setLastSynced(new Date());
    } catch (err) {
      setModelsError(err?.message || "Failed to load OpenRouter models");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const didInitRef = useRef(false);
  useEffect(() => {
    if (!isOpenRouter || didInitRef.current) return;
    didInitRef.current = true;
    loadPrefs();
    loadModels();
  }, [isOpenRouter, loadPrefs, loadModels]);

  // Also re-load prefs when connectionId changes (e.g. after adding a connection)
  useEffect(() => {
    if (isOpenRouter && connectionId) {
      loadPrefs();
    }
  }, [isOpenRouter, connectionId, loadPrefs]);

  // ── Save helpers ────────────────────────────────────────────────────────

  /** Save routing config to the connection via /api/openrouter/routing */
  const saveRouting = useCallback(async (nextPrefs) => {
    if (!connectionId) return;
    const routing = prefsToRouting(nextPrefs.mode, nextPrefs.preferredProviders);
    try {
      await fetch(
        `/api/openrouter/routing?connectionId=${encodeURIComponent(connectionId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(routing !== null ? { routing } : {}),
        }
      );
    } catch {
      // Silent fail — local state still reflects user intent
    }
  }, [connectionId]);

  /** Save model + reasoning to connection's providerSpecificData via PUT /api/providers/[id] */
  const saveModelAndReasoning = useCallback(async (model, reEnabled, reEffort) => {
    if (!connectionId) return;
    try {
      // Fetch current providerSpecificData to merge
      const connRes = await fetch(`/api/providers/${connectionId}`, { cache: "no-store" });
      const connData = connRes.ok ? await connRes.json() : {};
      const existingPsd = connData.connection?.providerSpecificData || {};

      const updatedPsd = {
        ...existingPsd,
        openrouterSelectedModel: model || undefined,
        openrouterReasoningEnabled: reEnabled,
        openrouterReasoningEffort: reEffort,
      };
      // Clean undefined keys
      if (!model) delete updatedPsd.openrouterSelectedModel;

      await fetch(`/api/providers/${connectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultModel: model || null,
          providerSpecificData: updatedPsd,
        }),
      });
    } catch {
      // Silent fail
    }
  }, [connectionId]);

  /** Combined save: routing + model + reasoning */
  const savePrefs = useCallback(async (nextPrefs, model, reEnabled, reEffort) => {
    setRoutingPrefs(nextPrefs);
    setSelectedModel(model);
    setReasoningEnabled(reEnabled);
    setReasoningEffort(reEffort);
    setSaving(true);
    try {
      await Promise.all([
        saveRouting(nextPrefs),
        saveModelAndReasoning(model, reEnabled, reEffort),
      ]);
    } finally {
      setSaving(false);
    }
  }, [saveRouting, saveModelAndReasoning]);

  // ── Event handlers ──────────────────────────────────────────────────────

  const handleModeChange = (mode) => {
    if (!routingPrefs) return;
    const next = { ...routingPrefs, mode };
    savePrefs(next, selectedModel, reasoningEnabled, reasoningEffort);
  };

  const handleModelSelect = (modelId) => {
    savePrefs(routingPrefs, modelId, reasoningEnabled, reasoningEffort);
  };

  const handleReasoningToggle = (enabled) => {
    savePrefs(routingPrefs, selectedModel, enabled, reasoningEffort);
  };

  const handleReasoningEffortChange = (effort) => {
    savePrefs(routingPrefs, selectedModel, reasoningEnabled, effort);
  };

  const togglePreferredProvider = (provider) => {
    if (!routingPrefs) return;
    const set = new Set(routingPrefs.preferredProviders);
    if (set.has(provider)) set.delete(provider);
    else set.add(provider);
    const next = { ...routingPrefs, preferredProviders: [...set], providerOrder: [...set] };
    savePrefs(next, selectedModel, reasoningEnabled, reasoningEffort);
  };

  const moveProvider = (index, direction) => {
    if (!routingPrefs || !routingPrefs.preferredProviders.length) return;
    const list = [...routingPrefs.preferredProviders];
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    const next = { ...routingPrefs, preferredProviders: list, providerOrder: list };
    savePrefs(next, selectedModel, reasoningEnabled, reasoningEffort);
  };

  // Selected model detail (for pricing display + reasoning capability)
  const selectedModelDetail = (() => {
    if (!selectedModel || models.length === 0) return null;
    return models.find((m) => m.id === selectedModel) || null;
  })();

  // Pricing comes from the model catalog (model-level, not per-provider)
  const selectedModelPricing = selectedModelDetail?.pricing || null;

  // Heuristic: models from providers known for reasoning support the setting
  const modelSupportsReasoning = (() => {
    if (!selectedModel) return false;
    const id = selectedModel.toLowerCase();
    return /(o3|o4|reasoning|deepseek-r|qwen.*qwq|claude.*thinking|gemini.*flash.*thinking|grok.*reason)/.test(id);
  })();

  if (!isOpenRouter || !routingPrefs) return null;

  return (
    <Card padding="md" className="border-orange-500/20">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-[10px] bg-orange-500/10">
            <span className="material-symbols-outlined text-[20px] text-orange-500">router</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold">OpenRouter Control</h2>
            <p className="text-xs text-text-muted">
              Model routing, provider preferences &amp; reasoning
              {lastSynced && <span className="ml-1.5 opacity-60">· synced {timeAgoShort(lastSynced)}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-xs text-text-muted inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              Saving…
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            onClick={() => { loadModels(); }}
            disabled={modelsLoading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {!activeConnection && (
        <div className="mb-4 rounded-[10px] border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-600 dark:text-yellow-400">
          No active OpenRouter connection. Add an API key connection first.
        </div>
      )}

      {/* Mode selector */}
      <div className="mb-5">
        <label className="mb-1.5 block text-sm font-medium text-text-main">Provider Mode</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              onClick={() => handleModeChange(mode.value)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-[10px] border p-3 text-left transition-all",
                routingPrefs.mode === mode.value
                  ? "border-orange-500/50 bg-orange-500/5"
                  : "border-border hover:border-orange-500/30 hover:bg-surface-2/50"
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {mode.label}
                {routingPrefs.mode === mode.value && (
                  <span className="material-symbols-outlined text-[14px] text-orange-500">check_circle</span>
                )}
              </span>
              <span className="text-xs text-text-muted leading-snug">{mode.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Model selection */}
      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-sm font-medium text-text-main">Default Model</label>
          {modelsError && <span className="text-xs text-red-500">{modelsError}</span>}
          {modelsLoading && (
            <span className="text-xs text-text-muted inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
              Loading models…
            </span>
          )}
        </div>
        <Select
          value={selectedModel}
          onChange={(e) => handleModelSelect(e.target.value)}
          options={[
            { value: "", label: "— No default (let client decide) —" },
            ...models.map((m) => ({
              value: m.id,
              label: m.name || m.id,
            })),
          ]}
          placeholder="Select a default model"
          hint={selectedModel ? `openrouter/${selectedModel}` : "Optional — clients can still override per-request"}
        />

        {/* Selected model pricing */}
        {selectedModel && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {selectedModelPricing ? (
              <>
                <Badge variant="info" size="sm" icon="input">
                  In: {formatPrice(selectedModelPricing.prompt)}
                </Badge>
                <Badge variant="success" size="sm" icon="output">
                  Out: {formatPrice(selectedModelPricing.completion)}
                </Badge>
                {selectedModelPricing.request > 0 && (
                  <Badge variant="default" size="sm" icon="bolt">
                    Per-req: {formatPrice(selectedModelPricing.request)}
                  </Badge>
                )}
              </>
            ) : selectedModelDetail ? (
              <Badge variant="success" size="sm" dot>Free model</Badge>
            ) : (
              <span className="text-xs text-text-muted">Pricing not available for this model</span>
            )}
            {selectedModelDetail?.contextLength && (
              <Badge variant="default" size="sm" icon="menu_book">
                {Math.round(selectedModelDetail.contextLength / 1000)}k ctx
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Reasoning settings */}
      {modelSupportsReasoning && (
        <div className="mb-5 rounded-[10px] border border-border-subtle bg-bg/50 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-purple-500">psychology</span>
              <div>
                <p className="text-sm font-medium text-text-main">Reasoning</p>
                <p className="text-xs text-text-muted">Control thinking effort for this model</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Toggle
                checked={reasoningEnabled}
                onChange={handleReasoningToggle}
                size="sm"
              />
              <Select
                value={reasoningEffort}
                onChange={(e) => handleReasoningEffortChange(e.target.value)}
                options={REASONING_EFFORTS}
                disabled={!reasoningEnabled}
                className="min-w-[120px]"
                selectClassName="py-1.5 text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Preferred providers (only meaningful for preferred/strict modes) */}
      {routingPrefs.mode !== "auto" && (
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <label className="text-sm font-medium text-text-main">
              {routingPrefs.mode === "strict" ? "Allowed Providers" : "Preferred Providers"}
            </label>
            {routingPrefs.preferredProviders.length > 0 && (
              <Badge variant="primary" size="sm">{routingPrefs.preferredProviders.length} selected</Badge>
            )}
          </div>
          <p className="mb-2 text-xs text-text-muted">
            {routingPrefs.mode === "strict"
              ? "OpenRouter will ONLY route to these providers. No fallback if all are down."
              : "OpenRouter prefers these providers but falls back to others if they are unavailable."}
          </p>

          {/* Selected providers with ordering */}
          {routingPrefs.preferredProviders.length > 0 && (
            <div className="mb-2 flex flex-col gap-1">
              {routingPrefs.preferredProviders.map((provider, index) => (
                <div
                  key={provider}
                  className="flex items-center gap-2 rounded-[8px] border border-orange-500/20 bg-orange-500/5 px-2.5 py-1.5"
                >
                  <span className="flex size-5 items-center justify-center rounded-full bg-orange-500/15 text-[10px] font-bold text-orange-600 dark:text-orange-400">
                    {index + 1}
                  </span>
                  <span className="flex-1 truncate text-sm text-text-main">{provider}</span>
                  <button
                    onClick={() => moveProvider(index, -1)}
                    disabled={index === 0}
                    className="p-0.5 text-text-muted hover:text-primary disabled:opacity-30"
                    title="Move up"
                  >
                    <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
                  </button>
                  <button
                    onClick={() => moveProvider(index, 1)}
                    disabled={index === routingPrefs.preferredProviders.length - 1}
                    className="p-0.5 text-text-muted hover:text-primary disabled:opacity-30"
                    title="Move down"
                  >
                    <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
                  </button>
                  <button
                    onClick={() => togglePreferredProvider(provider)}
                    className="p-0.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded"
                    title="Remove"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Available providers to add */}
          <div className="flex flex-wrap gap-1.5">
            {KNOWN_UPSTREAM_PROVIDERS
              .filter((p) => !routingPrefs.preferredProviders.includes(p))
              .map((provider) => (
                <button
                  key={provider}
                  onClick={() => togglePreferredProvider(provider)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-orange-500/40 hover:bg-orange-500/5 hover:text-orange-600 dark:hover:text-orange-400"
                >
                  <span className="material-symbols-outlined text-[12px]">add</span>
                  {provider}
                </button>
              ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function timeAgoShort(date) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
