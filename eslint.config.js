import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";

// Flat config for the whole workspace. `pnpm lint` runs `eslint .` once at the root.
//
// The three boundary blocks below are the load-bearing part of the "splittable
// monorepo" design: frontend and backend must NEVER import each other, and shared
// (the leaf both consume) must never depend on either app. The only allowed
// cross-package dependency is @notifications/shared. Because this is a lint error
// (not a convention), CI fails the moment someone couples the apps — which is what
// keeps them independently extractable into separate repos.
//
// Known gap: `no-restricted-imports` guards static imports only; a dynamic
// `import("../../backend/...")` is NOT caught. That's an unlikely coupling vector
// (and code review would catch it), but if we ever want the boundary airtight,
// swap in a path-based, dynamic-import-aware check (dependency-cruiser, or
// eslint-plugin-import's no-restricted-paths).
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/*.d.ts",
      "docs/**",
      // Build tooling configs pull in devDependencies / node globals; keep lint
      // focused on application source.
      "**/vite.config.ts",
      "**/tsup.config.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],

  {
    // Allow the underscore-prefix convention and the "omit via rest destructure"
    // pattern (`const { x: _drop, ...rest } = obj`) without tripping no-unused-vars.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    // Parse <script setup lang="ts"> blocks with the TypeScript parser.
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },

  {
    // Split-later boundary: frontend must not reach into backend.
    files: ["frontend/**/*.{ts,vue}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@notifications/backend",
                "@notifications/backend/**",
                "**/backend",
                "**/backend/**",
              ],
              message:
                "frontend must not import from backend — cross the boundary only via @notifications/shared.",
            },
          ],
        },
      ],
    },
  },

  {
    // Split-later boundary: backend must not reach into frontend.
    files: ["backend/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@notifications/frontend",
                "@notifications/frontend/**",
                "**/frontend",
                "**/frontend/**",
              ],
              message:
                "backend must not import from frontend — cross the boundary only via @notifications/shared.",
            },
          ],
        },
      ],
    },
  },

  {
    // Split-later boundary: shared is the leaf both apps consume — it must not
    // depend on either app, or it stops being independently publishable.
    files: ["packages/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@notifications/frontend",
                "@notifications/frontend/**",
                "@notifications/backend",
                "@notifications/backend/**",
                "**/frontend",
                "**/frontend/**",
                "**/backend",
                "**/backend/**",
              ],
              message:
                "@notifications/shared must not depend on either app — it is the leaf both sides consume.",
            },
          ],
        },
      ],
    },
  },
);
