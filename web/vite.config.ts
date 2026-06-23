import { defineConfig } from "vite";

// Relative base so the build works under a local server, a file path, or a tunnel domain.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", target: "es2022" },
});
