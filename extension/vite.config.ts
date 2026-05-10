import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Multi-entry Chrome extension build.
// Outputs:
//   dist/sidepanel/sidepanel.html  + sidepanel.js
//   dist/popup/popup.html          + popup.js
//   dist/background/service-worker.js  (no HTML, iife)
//
// manifest.json and icons live in public/ and are copied as-is.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "src/sidepanel/sidepanel.html"),
        popup: resolve(__dirname, "src/popup/popup.html"),
        "background/service-worker": resolve(
          __dirname,
          "src/background/service-worker.ts"
        ),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background/service-worker") {
            return "background/service-worker.js";
          }
          return "[name]/[name].js";
        },
        chunkFileNames: "shared/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
