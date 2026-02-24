import type { JsonObject, JsonValue } from "../types";
import type { GenAudioAssetRef } from "./genNodeConfig";

export const SFLOAD_NODES_LAYOUT_KEY = "sfload_nodes";

export interface SfloadNodeConfig {
  sampleAsset: GenAudioAssetRef | null;
  samplePath: string;
}

type SfloadNodeConfigMap = Record<string, SfloadNodeConfig>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[-+]?\d+$/.test(trimmed)) {
      return Math.max(1, Number.parseInt(trimmed, 10));
    }
  }
  return fallback;
}

function parseSampleAsset(value: unknown): GenAudioAssetRef | null {
  if (!isRecord(value)) {
    return null;
  }

  const assetId = typeof value.asset_id === "string" ? value.asset_id.trim() : "";
  const originalName = typeof value.original_name === "string" ? value.original_name.trim() : "";
  const storedName = typeof value.stored_name === "string" ? value.stored_name.trim() : "";
  if (!assetId || !originalName || !storedName) {
    return null;
  }

  return {
    asset_id: assetId,
    original_name: originalName,
    stored_name: storedName,
    content_type: typeof value.content_type === "string" ? value.content_type : "application/octet-stream",
    size_bytes: toPositiveInt(value.size_bytes, 1)
  };
}

export function defaultSfloadNodeConfig(): SfloadNodeConfig {
  return {
    sampleAsset: null,
    samplePath: ""
  };
}

export function normalizeSfloadNodeConfig(raw: unknown): SfloadNodeConfig {
  if (!isRecord(raw)) {
    return defaultSfloadNodeConfig();
  }

  return {
    sampleAsset: parseSampleAsset(raw.sampleAsset),
    samplePath: typeof raw.samplePath === "string" ? raw.samplePath : ""
  };
}

export function readSfloadNodeConfigMap(uiLayout: JsonObject): SfloadNodeConfigMap {
  const raw = uiLayout[SFLOAD_NODES_LAYOUT_KEY];
  if (!isRecord(raw)) {
    return {};
  }

  const result: SfloadNodeConfigMap = {};
  for (const [nodeId, value] of Object.entries(raw)) {
    if (!nodeId.trim()) {
      continue;
    }
    result[nodeId] = normalizeSfloadNodeConfig(value);
  }
  return result;
}

export function getSfloadNodeConfig(uiLayout: JsonObject, nodeId: string): SfloadNodeConfig {
  const map = readSfloadNodeConfigMap(uiLayout);
  return map[nodeId] ? normalizeSfloadNodeConfig(map[nodeId]) : defaultSfloadNodeConfig();
}

export function writeSfloadNodeConfigMap(uiLayout: JsonObject, map: SfloadNodeConfigMap): JsonObject {
  const nextLayout: JsonObject = { ...uiLayout };
  const entries = Object.entries(map);
  if (entries.length === 0) {
    delete nextLayout[SFLOAD_NODES_LAYOUT_KEY];
    return nextLayout;
  }

  const rawMap: Record<string, JsonValue> = {};
  for (const [nodeId, config] of entries) {
    rawMap[nodeId] = sfloadNodeConfigToJson(config);
  }
  nextLayout[SFLOAD_NODES_LAYOUT_KEY] = rawMap;
  return nextLayout;
}

export function setSfloadNodeConfig(uiLayout: JsonObject, nodeId: string, config: SfloadNodeConfig | null): JsonObject {
  const current = readSfloadNodeConfigMap(uiLayout);
  const next = { ...current };
  if (!config) {
    delete next[nodeId];
  } else {
    next[nodeId] = normalizeSfloadNodeConfig(config);
  }
  return writeSfloadNodeConfigMap(uiLayout, next);
}

function sfloadNodeConfigToJson(config: SfloadNodeConfig): JsonValue {
  return {
    sampleAsset: config.sampleAsset
      ? {
          asset_id: config.sampleAsset.asset_id,
          original_name: config.sampleAsset.original_name,
          stored_name: config.sampleAsset.stored_name,
          content_type: config.sampleAsset.content_type,
          size_bytes: config.sampleAsset.size_bytes
        }
      : null,
    samplePath: config.samplePath
  } satisfies JsonObject;
}
