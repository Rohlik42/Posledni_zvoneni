import { resolve } from "node:path";
import { defineConfig } from "vite";

// Havok and recast ship WASM that must not be pre-bundled.
const WASM_PACKAGES = ["@babylonjs/havok", "@recast-navigation/core", "@recast-navigation/generators"];
// Babylon is large by nature; split it so the warning threshold reflects game code.
const CHUNK_WARNING_LIMIT_KB = 4096;

export default defineConfig({
  base: "./",
  optimizeDeps: { exclude: WASM_PACKAGES },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: CHUNK_WARNING_LIMIT_KB,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        dev: resolve(import.meta.dirname, "dev/index.html"),
      },
    },
  },
});
