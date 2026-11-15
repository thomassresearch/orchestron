import type { SampleAsset, SampleAssets, SampleMap, SequencerInstrumentBinding } from "../types";
import { createUntitledPatch } from "./defaultPatch";

export function createSamplePlayerPatch() {
  const patch = createUntitledPatch();
  const { graph } = patch;
  graph.nodes.push({ id: "sample-player", opcode: "sample_player", params: {}, position: { x: 80, y: 80 } });
  for (const [side, y] of [["left", 0], ["right", 180]] as const) {
    const output = `output-${side}`;
    graph.nodes.push({ id: output, opcode: "outleta", params: { sname: side }, position: { x: 760, y } });
    graph.connections.push({
      from_node_id: "sample-player", from_port_id: `a${side}`,
      to_node_id: output, to_port_id: "asignal"
    });
  }
  graph.audio_interface = {
    role: "instrument",
    groups: [{ id: "main-output", name: "Stereo Output", direction: "output", layout: "stereo", ports: ["left", "right"], purpose: "main" }],
    mainInput: null,
    mainOutput: "main-output",
    guided: true
  };
  return { ...patch, name: "Sample Player", instrument_type: "percussion" as const };
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Sample Player data.");
  return value as Record<string, unknown>;
};
const opaque = /^[a-zA-Z0-9_-]{1,128}$/;
const digest = /^[0-9a-f]{64}$/;
const validFile = (file: Record<string, unknown>, ext: unknown): boolean =>
  typeof file.sha256 === "string" && digest.test(file.sha256) && file.stored_name === `sam-${file.sha256}.${ext}` &&
  Number.isSafeInteger(file.size_bytes) && Number(file.size_bytes) > 0;

export function parseSampleAssets(value: unknown): SampleAssets {
  if (value === undefined) return {};
  const pieces = Object.entries(object(value));
  if (pieces.length > 2048) throw new Error("Too many Sample Player assets.");
  for (const [id, item] of pieces) {
    const asset = object(item);
    const source = object(asset.source);
    const play = object(asset.playback);
    if (!opaque.test(id) || !["wav", "mp3", "m4a"].includes(String(source.format)) || !validFile(source, source.format) ||
        typeof source.original_name !== "string" || !source.original_name.length || source.original_name.length > 255 ||
        /[/\\]/.test(source.original_name) || source.original_name.includes(String.fromCharCode(0)) ||
        !validFile(play, "wav") || play.format !== "wav-f32le" || play.sampleRate !== 48000 || ![1, 2].includes(play.channels as number) ||
        !Number.isInteger(play.frameCount) || Number(play.frameCount) < 1 || Number(play.frameCount) > 5760000 ||
        typeof asset.decoderRevision !== "string" || !asset.decoderRevision.length || asset.decoderRevision.length > 128) {
      throw new Error("Invalid Sample Player asset metadata.");
    }
  }
  return Object.fromEntries(pieces) as SampleAssets;
}

export function readSampleBinding(value: unknown, assets: SampleAssets): Pick<SequencerInstrumentBinding, "sampleMap" | "sampleAssets"> {
  if (value === undefined) return {};
  const row = object(value);
  if (row.version !== 1 || !Array.isArray(row.entries) || row.entries.length > 128) throw new Error("Invalid Sample Player map version or length.");
  const notes = new Set<number>();
  const entries = row.entries.map(raw => {
    const entry = object(raw);
    const { note, assetId } = entry;
    if (typeof note !== "number" || !Number.isInteger(note) || note < 0 || note > 127 || notes.has(note) ||
        typeof assetId !== "string" || !Object.prototype.hasOwnProperty.call(assets, assetId)) throw new Error("Invalid, duplicated or unresolved Sample Player note.");
    notes.add(note);
    return { note, assetId };
  }).sort((a, b) => a.note - b.note);
  return {
    sampleMap: { version: 1, entries },
    sampleAssets: Object.fromEntries(entries.map(entry => [entry.assetId, assets[entry.assetId]]))
  };
}

export function sampleManifest(bindings: SequencerInstrumentBinding[]): SampleAssets {
  const assets = new Map<string, SampleAsset>();
  for (const binding of bindings) {
    for (const { assetId } of binding.sampleMap?.entries ?? []) {
      const asset = binding.sampleAssets?.[assetId];
      if (!asset) throw new Error("Missing Sample Player asset.");
      if (!assets.has(assetId)) assets.set(assetId, asset);
    }
  }
  return Object.fromEntries([...assets].sort(([a], [b]) => a.localeCompare(b)));
}

export const hasSampleMaps = (bindings: SequencerInstrumentBinding[]) => bindings.some(b => b.sampleMap !== undefined);

export function wireSampleMap(map: SampleMap | undefined) {
  return map ? { version: 1 as const, entries: map.entries.map(entry => ({ note: entry.note, asset_id: entry.assetId })) } : undefined;
}

export function sampleMapSignature(value: { entries: Array<{note: number; assetId?: string; asset_id?: string}> } | undefined) {
  return JSON.stringify(value?.entries.map(entry => [entry.note, entry.asset_id ?? entry.assetId]) ?? []);
}
