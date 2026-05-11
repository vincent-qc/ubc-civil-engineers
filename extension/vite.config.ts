<<<<<<< Updated upstream
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
=======
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import type { Plugin } from 'vite';

// Plugin to inline all imports for content script
const inlineContentScript = (): Plugin => ({
  name: 'inline-content-script',
  apply: 'build',
  enforce: 'post',
  generateBundle(options, bundle) {
    // Find the content script
    const contentScript = Object.keys(bundle).find(key => key.includes('content/index'));
    if (!contentScript) return;

    const contentChunk = bundle[contentScript];
    if (contentChunk.type !== 'chunk') return;

    // Find all chunks that the content script imports
    const importsToInline: string[] = [];
    Object.keys(bundle).forEach(key => {
      if (key.includes('constants') || (key !== contentScript && contentChunk.imports?.includes(key))) {
        importsToInline.push(key);
      }
    });

    // Inline the imports into the content script
    importsToInline.forEach(importKey => {
      const importChunk = bundle[importKey];
      if (importChunk.type === 'chunk') {
        // Prepend the imported code to the content script (without exports)
        let inlinedCode = importChunk.code;
        // Remove export statements since everything is in one file now
        inlinedCode = inlinedCode.replace(/export\s*{[^}]+};?\s*/g, '');
        inlinedCode = inlinedCode.replace(/export\s+/g, '');

        contentChunk.code = inlinedCode + '\n' + contentChunk.code;
        // Remove the import statement from content script
        contentChunk.code = contentChunk.code.replace(/import\s*{[^}]+}\s*from\s*['"][^'"]+['"];?\s*/g, '');
        // Delete the separate chunk
        delete bundle[importKey];
      }
    });
  },
});

// Plugin to copy static assets
const copyAssets = () => ({
  name: 'copy-assets',
  closeBundle() {
    const publicDir = resolve(__dirname, 'public');
    const distDir = resolve(__dirname, 'dist');

    // Copy manifest.json
    copyFileSync(
      resolve(publicDir, 'manifest.json'),
      resolve(distDir, 'manifest.json')
    );

    // Copy assets directory
    const assetsSource = resolve(publicDir, 'assets');
    const assetsDest = resolve(distDir, 'assets');

    if (!existsSync(assetsDest)) {
      mkdirSync(assetsDest, { recursive: true });
    }

    // Copy icon files if they exist
    const iconFiles = ['icon-16.svg', 'icon-48.svg', 'icon-128.svg'];
    for (const iconFile of iconFiles) {
      const sourcePath = resolve(assetsSource, iconFile);
      const destPath = resolve(assetsDest, iconFile);
      if (existsSync(sourcePath)) {
        copyFileSync(sourcePath, destPath);
      }
    }

    // Move popup HTML to correct location and fix paths
    const htmlSource = resolve(distDir, 'src/popup/index.html');
    const htmlDest = resolve(distDir, 'popup/index.html');
    if (existsSync(htmlSource)) {
      let html = readFileSync(htmlSource, 'utf-8');
      // Fix paths in HTML
      html = html.replace(/src="\.\.\/\.\.\/popup\//g, 'src="./');
      html = html.replace(/href="\.\.\/\.\.\/popup\//g, 'href="./');
      writeFileSync(htmlDest, html);
    }
  },
});
>>>>>>> Stashed changes

// Multi-entry Chrome extension build.
// Outputs:
//   dist/sidepanel/sidepanel.html  + sidepanel.js
//   dist/popup/popup.html          + popup.js
//   dist/background/service-worker.js  (no HTML, iife)
//
// manifest.json and icons live in public/ and are copied as-is.
export default defineConfig({
<<<<<<< Updated upstream
<<<<<<< Updated upstream
  plugins: [react()],
=======
=======
>>>>>>> Stashed changes
  plugins: [react(), inlineContentScript(), copyAssets()],
  base: './',
>>>>>>> Stashed changes
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
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
<<<<<<< Updated upstream
<<<<<<< Updated upstream
        chunkFileNames: "shared/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
=======
        // Don't code split - force all code to be inlined
        manualChunks: () => null,
>>>>>>> Stashed changes
=======
        // Don't code split - force all code to be inlined
        manualChunks: () => null,
>>>>>>> Stashed changes
      },
      treeshake: {
        moduleSideEffects: false,
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
