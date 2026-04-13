import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/client/" : "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/src/components/DocumentationModalFrame.tsx") ||
            id.includes("/src/components/MarkdownRenderer.tsx") ||
            id.includes("/src/lib/documentationUi.ts")
          ) {
            return "docs-shared";
          }

          if (id.includes("/src/lib/documentation.ts") || id.includes("/src/components/HelpDocumentationModal.tsx")) {
            return "help-docs";
          }

          if (
            id.includes("/src/lib/opcodeDocumentation.ts") ||
            id.includes("/src/lib/opcodeDocDetails.json") ||
            id.includes("/src/components/OpcodeDocumentationModal.tsx")
          ) {
            return "opcode-docs";
          }

          if (id.includes("node_modules/rete") || id.includes("node_modules/rete-")) {
            return "rete-vendor";
          }

          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/scheduler")
          ) {
            return "react-vendor";
          }
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  }
}));
