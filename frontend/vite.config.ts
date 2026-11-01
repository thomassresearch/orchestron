import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { opcodeDocsChunkName, opcodeDocsChunks } from "./build/opcodeDocsChunks.mjs";

const DOCS_SHARED_PATTERNS = [
  "/src/components/DocumentationModalFrame.tsx",
  "/src/components/MarkdownRenderer.tsx",
  "/src/lib/documentationUi.ts"
];

const HELP_DOCS_PATTERNS = [
  "/src/lib/documentation.ts",
  "/src/lib/helpDocumentation",
  "/src/components/HelpDocumentationModal.tsx"
];

const OPCODE_DOCS_PATTERNS = [
  "/src/lib/opcodeDocumentation.ts",
  "/src/lib/opcodeDocDetails.json",
  "/src/components/OpcodeDocumentationModal.tsx"
];

const RETE_VENDOR_PATTERNS = ["node_modules/rete", "node_modules/rete-"];
const REACT_VENDOR_PATTERNS = ["node_modules/react", "node_modules/react-dom", "node_modules/scheduler"];

function matchesAnyPattern(id: string, patterns: string[]): boolean {
  return patterns.some((pattern) => id.includes(pattern));
}

function chunkName(id: string): string | undefined {
  const opcodeDataChunk = opcodeDocsChunkName(id);
  if (opcodeDataChunk) return opcodeDataChunk;

  // Keep the large built-in template independently cacheable without changing its synchronous API.
  if (id.endsWith("/examples/instruments/template/analog_drumkit.patch.json")) {
    return "drumkit-template";
  }

  if (matchesAnyPattern(id, DOCS_SHARED_PATTERNS)) {
    return "docs-shared";
  }

  // Keep help documentation payloads in a deferred chunk even as the docs data is split across modules.
  if (matchesAnyPattern(id, HELP_DOCS_PATTERNS)) {
    return "help-docs";
  }

  if (matchesAnyPattern(id, OPCODE_DOCS_PATTERNS)) {
    return "opcode-docs";
  }

  if (matchesAnyPattern(id, RETE_VENDOR_PATTERNS)) {
    return "rete-vendor";
  }

  if (matchesAnyPattern(id, REACT_VENDOR_PATTERNS)) {
    return "react-vendor";
  }

  return undefined;
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/client/" : "/",
  plugins: [react(), opcodeDocsChunks()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Shared UI helpers must not pull their documentation consumers into startup imports.
          includeDependenciesRecursively: false,
          groups: [{ name: chunkName }]
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  }
}));
