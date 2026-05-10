import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

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

export default defineConfig({
  plugins: [react(), copyAssets()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        popup: resolve(__dirname, 'src/popup/index.html'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background/index.js';
          if (chunkInfo.name === 'content') return 'content/index.js';
          return '[name]/[name].js';
        },
        chunkFileNames: '[name]/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'index.html') return 'popup/index.html';
          if (assetInfo.name?.endsWith('.css')) return 'popup/[name][extname]';
          return 'assets/[name][extname]';
        },
      },
    },
  },
});
