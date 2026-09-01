import { defineConfig } from "vite";

// Relative base so the build works under a local server, a file path, or a tunnel domain.
// Fixed (un-hashed) asset names so a consuming instance can reference dist/assets/index.{js,css}
// stably and not rewrite its host page on every rebuild.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/index[extname]",
      },
    },
  },
});
