// Simple icon generation script
// Creates basic placeholder icons for the extension

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sizes = [16, 48, 128];
const color = '#2196F3'; // Blue color

function generateSVG(size) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="${color}" rx="4"/>
  <text x="50%" y="50%" font-family="Arial" font-size="${size * 0.5}"
        fill="white" text-anchor="middle" dominant-baseline="middle"
        font-weight="bold">A</text>
</svg>`;
}

// Create assets directory if it doesn't exist
const assetsDir = resolve(__dirname, '../public/assets');
try {
  mkdirSync(assetsDir, { recursive: true });
} catch (e) {
  // Directory already exists
}

// Generate SVG icons (Chrome supports SVG icons)
for (const size of sizes) {
  const svg = generateSVG(size);
  const filename = `icon-${size}.svg`;
  const filepath = resolve(assetsDir, filename);
  writeFileSync(filepath, svg);
  console.log(`Generated ${filename}`);
}

console.log('\nIcons generated successfully!');
console.log('Note: For production, consider using PNG images instead of SVG.');
console.log('You can use tools like ImageMagick or online converters to create PNG icons.');
