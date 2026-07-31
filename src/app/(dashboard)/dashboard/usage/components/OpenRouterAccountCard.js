"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Card, Badge, Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

/**
 * OpenRouterAccountCard — account & quota summary for OpenRouter.
 *
 * Displays credit balance, usage limits, and rate-limit info pulled from the
 * OpenRouter account. Designed to slot into the existing usage/quota pages
 * alongside the ProviderLimits component.
 *
 * Data sources (all fetched client-side, fail gracefully):
 *  - /api/openrouter/credits — key info from OpenRouter GET /api/v1/key endpoint
 *    (returns limit, limit_remaining, usage, usage_daily/weekly/monthly, is_free_tier)
 *  - /api/settings — openrouterPreferences (read-only display of current mode)
 *
 * States: loading → loaded | error | empty (no connection)
 * Mobile-friendly: stacked layout on small screens, grid on sm+.
 */

function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function timeAgo(date) {
  if (!date) return "never";
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function OpenRouterAccountCard() {
  const [state, setState] = useState("loading"); // loading | loaded | error | empty
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  const [lastSynced, setLastSynced] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAccount = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      // Step 1: fetch credit info from the OpenRouter backend (uses the user's
      // active OpenRouter connection API key to call GET /api/v1/key on OpenRouter).
      // The backend handles connection lookup internally.
      const creditsRes = await fetch("/api/openrouter/credits", { cache: "no-store" });
      if (creditsRes.status === 404) {
        setState("empty");
        setAccount(null);
        setLastSynced(new Date());
        return;
      }
      if (!creditsRes.ok) {
        const errBody = await creditsRes.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to fetch OpenRouter credit info");
      }
      const creditsData = await creditsRes.json();

      // Step 2: fetch OpenRouter preferences for mode display
      let prefs = null;
      try {
        const settingsRes = await fetch("/api/settings", { cache: "no-store" });
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          prefs = settingsData.openrouterPreferences || null;
        }
      } catch {
        // prefs are optional
      }

      setAccount({
        credits: creditsData.credits || null,
        keyInfo: creditsData.keyInfo || null,
        connectionId: creditsData.connectionId || null,
        prefs,
      });
      setState("loaded");
      setLastSynced(new Date());
    } catch (err) {
      setError(err?.message || "Failed to load OpenRouter account data");
      setState("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const didInitRef = useRef(false);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    fetchAccount();
  }, [fetchAccount]);

  // Derive display values from quota data (OpenRouter returns credits in various shapes)
  const derived = (() => {
    const c = account?.credits;
    if (!c) return null;
    // The /key endpoint returns per-key limit and usage, NOT account balance.
    // limit_remaining = remaining credits on this key (the "balance" from user perspective).
    // limit = per-key credit cap (null if unlimited).
    // usage = all-time credits consumed by this key.
    return {
      limitRemaining: c.limitRemaining ?? null,
      limit: c.limit ?? null,
      limitReset: c.limitReset ?? null,
      usage: c.usage ?? null,
      usageDaily: c.usageDaily ?? null,
      usageWeekly: c.usageWeekly ?? null,
      usageMonthly: c.usageMonthly ?? null,
      isFreeTier: c.isFreeTier ?? null,
    };
  })();

  return (
    <Card padding="md" className="border-orange-500/20">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-orange-500/10">
            <span className="material-symbols-outlined text-[20px] text-orange-500">router</span>
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">OpenRouter Account</h3>
            <p className="text-xs text-text-muted">
              Credit balance &amp; rate limits
              {lastSynced && <span className="ml-1.5 opacity-60">· synced {timeAgo(lastSynced)}</span>}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={refreshing ? "" : "refresh"}
          onClick={fetchAccount}
          disabled={refreshing}
          className="shrink-0"
        >
          {refreshing ? (
            <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
          ) : null}
          {refreshing ? "Syncing…" : "Sync"}
        </Button>
      </div>

      {/* Loading state */}
      {state === "loading" && (
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-[24px] text-orange-500 animate-spin">progress_activity</span>
            <p className="text-xs text-text-muted">Loading account data…</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {state === "error" && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-red-500/10">
            <span className="material-symbols-outlined text-[20px] text-red-500">error</span>
          </div>
          <div>
            <p className="text-sm font-medium text-text-main">Failed to load account</p>
            <p className="mt-0.5 max-w-xs text-xs text-text-muted break-words">{error}</p>
          </div>
          <Button size="sm" variant="secondary" icon="refresh" onClick={fetchAccount}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty state — no OpenRouter connection */}
      {state === "empty" && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-surface-2">
            <span className="material-symbols-outlined text-[20px] text-text-muted">router</span>
          </div>
          <div>
            <p className="text-sm font-medium text-text-main">No OpenRouter connection</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Add an OpenRouter API key in{" "}
              <Link href="/dashboard/providers/openrouter" className="text-primary hover:underline">
                Providers
              </Link>{" "}
              to see account data here.
            </p>
          </div>
        </div>
      )}

      {/* Loaded — show account data */}
      {state === "loaded" && account && (
        <div className="flex flex-col gap-3">
          {/* Connection info */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default" size="sm" icon="key">
              OpenRouter API Key
            </Badge>
            {account.prefs?.mode && (
              <Badge variant="info" size="sm" icon="tune">
                Mode: {account.prefs.mode}
              </Badge>
            )}
            {account.prefs?.selectedModel && (
              <Badge variant="primary" size="sm" icon="smart_toy">
                {account.prefs.selectedModel.split("/").pop()}
              </Badge>
            )}
          </div>

          {/* Credit info from GET /api/v1/key */}
          {derived ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-[10px] border border-border-subtle bg-bg/50 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  {derived.limit != null ? "Key Limit" : "Balance"}
                </p>
                <p className={cn(
                  "mt-1 text-lg font-bold",
                  derived.limitRemaining != null && derived.limitRemaining > 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-text-muted",
                )}>
                  {derived.limitRemaining != null ? formatUsd(derived.limitRemaining) : "Unlimited"}
                </p>
              </div>
              {derived.limit != null && (
                <div className="rounded-[10px] border border-border-subtle bg-bg/50 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Key Cap</p>
                  <p className="mt-1 text-lg font-bold text-text-main">
                    {formatUsd(derived.limit)}
                  </p>
                </div>
              )}
              <div className="rounded-[10px] border border-border-subtle bg-bg/50 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Total Used</p>
                <p className="mt-1 text-lg font-bold text-text-main">
                  {formatUsd(derived.usage)}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-[10px] border border-dashed border-border-subtle bg-bg/30 p-4 text-center">
              <p className="text-xs text-text-muted">
                No OpenRouter connection found or key info unavailable.
              </p>
              <p className="mt-1 text-[11px] text-text-muted opacity-70">
                Add an OpenRouter API key in Providers to see credit data here.
              </p>
            </div>
          )}

          {/* Usage breakdown + free tier status */}
          {derived && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {derived.isFreeTier && (
                <Badge variant="warning" size="sm" icon="info">
                  Free tier
                </Badge>
              )}
              {derived.usageDaily != null && (
                <Badge variant="default" size="sm">
                  Today: {formatUsd(derived.usageDaily)}
                </Badge>
              )}
              {derived.usageMonthly != null && (
                <Badge variant="default" size="sm">
                  Month: {formatUsd(derived.usageMonthly)}
                </Badge>
              )}
              {derived.limitReset && (
                <Badge variant="default" size="sm">
                  Resets: {derived.limitReset}
                </Badge>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
