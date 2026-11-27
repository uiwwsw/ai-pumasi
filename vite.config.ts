import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const stub = (name: string) =>
  fileURLToPath(new URL(`./src/web-stubs/${name}.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: "./",
  // The web version runs the app's provider and team code (electron/*.cjs) in the browser.
  resolve: {
    alias: { "node:path": stub("node-path"), "node:fs": stub("node-fs") },
  },
  optimizeDeps: { include: [] },
  build: {
    commonjsOptions: { include: [/node_modules/, /electron\//], transformMixedEsModules: true },
  },
});
