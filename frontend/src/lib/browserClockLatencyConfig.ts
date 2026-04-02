import { wsBaseUrl } from "../api/client";
import type { BrowserClockLatencySettings } from "../types";

export const BROWSER_CLOCK_WATER_MS_MIN = 20;
export const BROWSER_CLOCK_WATER_MS_MAX = 2_000;
export const BROWSER_CLOCK_BOOST_MS_MIN = 0;
export const BROWSER_CLOCK_BOOST_MS_MAX = 2_000;
export const BROWSER_CLOCK_MAX_BLOCKS_MIN = 1;
export const BROWSER_CLOCK_MAX_BLOCKS_MAX = 512;
export const BROWSER_CLOCK_PARALLEL_REQUESTS_MIN = 1;
export const BROWSER_CLOCK_PARALLEL_REQUESTS_MAX = 6;
export const BROWSER_CLOCK_IMMEDIATE_RENDER_BLOCKS_MIN = 1;
export const BROWSER_CLOCK_IMMEDIATE_RENDER_BLOCKS_MAX = 128;
export const BROWSER_CLOCK_IMMEDIATE_COOLDOWN_MS_MIN = 0;
export const BROWSER_CLOCK_IMMEDIATE_COOLDOWN_MS_MAX = 1_000;

export const REMOTE_BROWSER_CLOCK_LATENCY_SETTINGS: BrowserClockLatencySettings = {
  steadyLowWaterMs: 450,
  steadyHighWaterMs: 900,
  startupLowWaterMs: 750,
  startupHighWaterMs: 1_500,
  underrunRecoveryBoostMs: 300,
  maxUnderrunBoostMs: 1_200,
  maxBlocksPerRequest: 384,
  steadyMaxParallelRequests: 2,
  startupMaxParallelRequests: 3,
  recoveryMaxParallelRequests: 3,
  immediateRenderBlocks: 32,
  immediateRenderCooldownMs: 25
};

export const LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS: BrowserClockLatencySettings = {
  steadyLowWaterMs: 90,
  steadyHighWaterMs: 180,
  startupLowWaterMs: 180,
  startupHighWaterMs: 320,
  underrunRecoveryBoostMs: 120,
  maxUnderrunBoostMs: 600,
  maxBlocksPerRequest: 96,
  steadyMaxParallelRequests: 2,
  startupMaxParallelRequests: 3,
  recoveryMaxParallelRequests: 3,
  immediateRenderBlocks: 24,
  immediateRenderCooldownMs: 25
};

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clampInt(value, min, max);
}

function isLikelyLocalBrowserClockHost(): boolean {
  const hostnames = new Set<string>();
  if (typeof window !== "undefined") {
    hostnames.add(window.location.hostname.trim().toLowerCase());
  }
  try {
    hostnames.add(new URL(wsBaseUrl()).hostname.trim().toLowerCase());
  } catch {
    // Ignore invalid websocket base values and fall back to window.location.
  }

  for (const hostname of hostnames) {
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]"
    ) {
      return true;
    }
    if (hostname.endsWith(".local")) {
      return true;
    }

    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4Match) {
      continue;
    }

    const octets = ipv4Match.slice(1).map((part) => Number.parseInt(part, 10));
    if (octets.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
      continue;
    }

    if (octets[0] === 10 || octets[0] === 127) {
      return true;
    }
    if (octets[0] === 192 && octets[1] === 168) {
      return true;
    }
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return true;
    }
  }

  return false;
}

export function resolveDefaultBrowserClockLatencySettings(): BrowserClockLatencySettings {
  return isLikelyLocalBrowserClockHost()
    ? { ...LOCAL_BROWSER_CLOCK_LATENCY_SETTINGS }
    : { ...REMOTE_BROWSER_CLOCK_LATENCY_SETTINGS };
}

export function normalizeBrowserClockLatencySettings(
  value: Partial<BrowserClockLatencySettings> | null | undefined,
  fallback?: BrowserClockLatencySettings
): BrowserClockLatencySettings {
  const base = fallback ?? resolveDefaultBrowserClockLatencySettings();

  const steadyLowWaterMs = normalizeInteger(
    value?.steadyLowWaterMs,
    base.steadyLowWaterMs,
    BROWSER_CLOCK_WATER_MS_MIN,
    BROWSER_CLOCK_WATER_MS_MAX
  );
  const steadyHighWaterMs = Math.max(
    steadyLowWaterMs + 1,
    normalizeInteger(
      value?.steadyHighWaterMs,
      base.steadyHighWaterMs,
      BROWSER_CLOCK_WATER_MS_MIN,
      BROWSER_CLOCK_WATER_MS_MAX
    )
  );
  const startupLowWaterMs = normalizeInteger(
    value?.startupLowWaterMs,
    base.startupLowWaterMs,
    BROWSER_CLOCK_WATER_MS_MIN,
    BROWSER_CLOCK_WATER_MS_MAX
  );
  const startupHighWaterMs = Math.max(
    startupLowWaterMs + 1,
    normalizeInteger(
      value?.startupHighWaterMs,
      base.startupHighWaterMs,
      BROWSER_CLOCK_WATER_MS_MIN,
      BROWSER_CLOCK_WATER_MS_MAX
    )
  );

  return {
    steadyLowWaterMs,
    steadyHighWaterMs,
    startupLowWaterMs,
    startupHighWaterMs,
    underrunRecoveryBoostMs: normalizeInteger(
      value?.underrunRecoveryBoostMs,
      base.underrunRecoveryBoostMs,
      BROWSER_CLOCK_BOOST_MS_MIN,
      BROWSER_CLOCK_BOOST_MS_MAX
    ),
    maxUnderrunBoostMs: normalizeInteger(
      value?.maxUnderrunBoostMs,
      base.maxUnderrunBoostMs,
      BROWSER_CLOCK_BOOST_MS_MIN,
      BROWSER_CLOCK_BOOST_MS_MAX
    ),
    maxBlocksPerRequest: normalizeInteger(
      value?.maxBlocksPerRequest,
      base.maxBlocksPerRequest,
      BROWSER_CLOCK_MAX_BLOCKS_MIN,
      BROWSER_CLOCK_MAX_BLOCKS_MAX
    ),
    steadyMaxParallelRequests: normalizeInteger(
      value?.steadyMaxParallelRequests,
      base.steadyMaxParallelRequests,
      BROWSER_CLOCK_PARALLEL_REQUESTS_MIN,
      BROWSER_CLOCK_PARALLEL_REQUESTS_MAX
    ),
    startupMaxParallelRequests: normalizeInteger(
      value?.startupMaxParallelRequests,
      base.startupMaxParallelRequests,
      BROWSER_CLOCK_PARALLEL_REQUESTS_MIN,
      BROWSER_CLOCK_PARALLEL_REQUESTS_MAX
    ),
    recoveryMaxParallelRequests: normalizeInteger(
      value?.recoveryMaxParallelRequests,
      base.recoveryMaxParallelRequests,
      BROWSER_CLOCK_PARALLEL_REQUESTS_MIN,
      BROWSER_CLOCK_PARALLEL_REQUESTS_MAX
    ),
    immediateRenderBlocks: normalizeInteger(
      value?.immediateRenderBlocks,
      base.immediateRenderBlocks,
      BROWSER_CLOCK_IMMEDIATE_RENDER_BLOCKS_MIN,
      BROWSER_CLOCK_IMMEDIATE_RENDER_BLOCKS_MAX
    ),
    immediateRenderCooldownMs: normalizeInteger(
      value?.immediateRenderCooldownMs,
      base.immediateRenderCooldownMs,
      BROWSER_CLOCK_IMMEDIATE_COOLDOWN_MS_MIN,
      BROWSER_CLOCK_IMMEDIATE_COOLDOWN_MS_MAX
    )
  };
}
