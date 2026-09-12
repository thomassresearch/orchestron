import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

const patchFixtures = new URL("../backend/tests/fixtures/patches/", import.meta.url);
const examplesDirectory = fileURLToPath(new URL("../examples/", import.meta.url));

export default defineConfig((environment) => mergeConfig(viteConfig(environment), {
  resolve: {
    // The production template loader imports the developer's example patch.
    // Tests always resolve that import to their own fixed snapshot instead.
    alias: [{
      find: /^(?:\.\.\/)+examples\/analog_drumkit\.patch\.json$/,
      replacement: fileURLToPath(new URL("analog_drumkit.patch.json", patchFixtures))
    }]
  },
  plugins: [{
    name: "test-fixture-isolation",
    enforce: "pre",
    load(id) {
      if (id.startsWith(examplesDirectory)) {
        throw new Error("Tests must use fixtures under a tests directory, not developer examples.");
      }
    }
  }]
}));
