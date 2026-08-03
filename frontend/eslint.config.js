import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.worker
      }
    },
    rules: {
      // Gradually replace boundary-level `any` values as the store and runtime
      // protocols are split. Enabling this now would require an unrelated sweep.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: ["src/audio/browserClockProcessor.js"],
    languageOptions: {
      globals: {
        ...globals.worker,
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly"
      }
    }
  }
);
