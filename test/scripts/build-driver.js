const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'scripts', 'desktop-driver.m');
const outputDir = path.join(root, 'bin');
const output = path.join(outputDir, 'desktop-driver');

fs.mkdirSync(outputDir, { recursive: true });

const result = spawnSync(
  '/usr/bin/clang',
  [
    '-fobjc-arc',
    '-fno-modules',
    '-mmacosx-version-min=14.0',
    '-framework',
    'Foundation',
    '-framework',
    'AppKit',
    '-framework',
    'ApplicationServices',
    source,
    '-o',
    output
  ],
  {
    cwd: root,
    stdio: 'inherit'
  }
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}
