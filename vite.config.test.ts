import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

/**
 * Browser-check build. The Playwright pages under test/ are deliberately
 * excluded from the production build (`vite.config.ts`); `npm run build:test`
 * writes them to dist-test/, which scripts/run-checks.mjs serves.
 */
export default defineConfig({
  base: "./",
  plugins: [svelte()],
  build: {
    outDir: "dist-test",
    rollupOptions: {
      input: {
        "engine-check": "test/engine.html",
        "view-check": "test/view.html",
        "analyze-check": "test/analyze.html",
        "explore-check": "test/explore.html",
      },
    },
  },
});
