import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs keep the build working both at a domain root and
  // under a sub-path (e.g. a GitHub Pages project site).
  base: "./",
  plugins: [svelte()],
  server: { port: 8080 },
});
