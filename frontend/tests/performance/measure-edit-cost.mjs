// Run from the repository root; an optional Git revision supplies the pre-change edit implementation.
import { createServer } from "vite";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const baseline = process.argv[2];
const editModules = ["frontend/src/store/sequencerEdits.ts", "frontend/src/store/appStoreSequencerTracksSlice.ts"];
const baselineSources = new Map(baseline ? editModules.map(path => [
  `${root}/${path}`, execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" })
]) : []);
const cacheDir = await mkdtemp(join(tmpdir(), "orchestron-edit-benchmark-"));

function medianMs(operation) {
  for (let index = 0; index < 5; index++) operation();
  const times = Array.from({ length: 25 }, () => {
    const start = performance.now();
    operation();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return Number(times[12].toFixed(3));
}

async function measureNoteEdits(server, mode) {
  const { useAppStore: store } = await server.ssrLoadModule(`${root}/frontend/src/store/useAppStore.ts`);
  for (const count of [1, 8, 16]) {
    store.setState(store.getInitialState(), true);
    const sequencer = structuredClone(store.getState().sequencer);
    const template = sequencer.tracks[0];
    sequencer.tracks = Array.from({ length: count }, (_, index) => ({ ...structuredClone(template), id: `track-${index}` }));
    store.setState({ sequencer });
    let note = 60;
    const elapsed = medianMs(() => {
      note = note === 60 ? 61 : 60;
      store.getState().setSequencerTrackStepNote("track-0", 0, note);
    });
    console.log(JSON.stringify({ mode, tracks: count, noteEditMedianMs: elapsed }));
  }
}

async function measureFormulas(server) {
  const { readInputFormulaMap } = await server.ssrLoadModule(`${root}/frontend/src/lib/graphFormula.ts`);
  const { inputFormulasByNode, nodeInputPresentation } = await server.ssrLoadModule(`${root}/frontend/src/lib/graphInputPresentation.ts`);
  for (const count of [100, 300, 600]) {
    const nodes = Array.from({ length: count }, (_, index) => ({ id: `n${index}`, params: { value: index } }));
    const layout = { input_formulas: Object.fromEntries(nodes.map(node => [`${node.id}::in`, {
      expression: "x1*.5", inputs: [{ token: "x1", from_node_id: "source", from_port_id: "out" }]
    }])) };
    // Original render-key algorithm retained only as the benchmark baseline.
    const before = () => JSON.stringify(nodes.map(node => [node.id, node.params,
      Object.entries(readInputFormulaMap(layout)).filter(([key]) => key.startsWith(`${node.id}::`))]));
    // Includes indexing on every sample; unchanged formulas are additionally cached in React.
    const after = () => JSON.stringify([...nodeInputPresentation(nodes, inputFormulasByNode(layout))]);
    console.log(JSON.stringify({ formulas: count, previousFormulaMedianMs: medianMs(before), workingMedianMs: medianMs(after) }));
  }
}

try {
  for (const mode of baseline ? ["baseline", "working"] : ["working"]) {
    const server = await createServer({
      root: `${root}/frontend`, cacheDir, logLevel: "error", configFile: `${root}/frontend/vitest.config.ts`,
      server: { middlewareMode: true, ws: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: mode === "baseline" ? [{
        name: "review-baseline", enforce: "pre", transform: (_, id) => baselineSources.get(id)
      }] : []
    });
    try {
      await measureNoteEdits(server, mode);
      if (mode === "working") await measureFormulas(server);
    } finally {
      await server.close();
    }
  }
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}
