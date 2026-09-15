import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import ts from "typescript";
import testConfig from "../../vitest.config.ts";

// Reuses fixture isolation. Instrumentation is confined to this manual profiling server.
export default defineConfig(environment => mergeConfig(testConfig(environment), {
  root: fileURLToPath(new URL("../../", import.meta.url)),
  server: {
    host: "127.0.0.1", port: 5178, strictPort: true,
    headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    proxy: {
      "/api": { target: "http://127.0.0.1:8000" },
      "/ws": { target: "ws://127.0.0.1:8000", ws: true }
    }
  },
  plugins: [{
    name: "profile-visual-construction", enforce: "pre",
    transform(source, id) {
      if (!id.includes("/src/components/") && !id.endsWith("/src/lib/sequencer.ts")) return;
      const file = ts.createSourceFile(id, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const positions = [];
      function visit(node) {
        if (ts.isFunctionDeclaration(node) && node.body && node.name &&
          (/Body$/.test(node.name.text) || ["Meter", "buildControllerCurvePath", "buildSequencerNoteOptions"].includes(node.name.text))) {
          positions.push({ offset: node.body.getStart(file) + 1, name: node.name.text });
        }
        ts.forEachChild(node, visit);
      }
      visit(file);
      for (const { offset, name } of positions.reverse()) {
        source = source.slice(0, offset) + `\nwindow.__collapseProfile?.count(${JSON.stringify(name)});\n` + source.slice(offset);
      }
      return positions.length ? source : undefined;
    }
  }]
}));
