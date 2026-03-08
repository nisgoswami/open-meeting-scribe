#!/usr/bin/env node
/**
 * package.js
 *
 * Packages the extension into a ZIP file suitable for uploading to the
 * Chrome Web Store.
 *
 * Usage:
 *   node scripts/package.js
 *
 * Output: dist/open-meeting-scribe-<version>.zip
 *
 * This script intentionally has no external dependencies — it uses only
 * Node built-ins to keep the build toolchain minimal.
 */

const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');

const ROOT    = path.join(__dirname, '..');
const DIST    = path.join(ROOT, 'dist');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const VERSION = MANIFEST.version;
const ZIP_NAME = `open-meeting-scribe-${VERSION}.zip`;
const ZIP_PATH = path.join(DIST, ZIP_NAME);

// Files and directories to include in the package.
const INCLUDE = [
  'manifest.json',
  'src/',
  'public/',
];

// Files to exclude (use .gitignore-style matching).
const EXCLUDE = [
  '*.map',
  '*.test.*',
  '.DS_Store',
  'node_modules',
  '.git',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildExcludeArgs() {
  return EXCLUDE.map((p) => `--exclude=${p}`).join(' ');
}

ensureDir(DIST);

// Verify icons exist before packaging.
const requiredIcons = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'];
const missingIcons = requiredIcons.filter(
  (icon) => !fs.existsSync(path.join(ROOT, 'public', 'icons', icon))
);

if (missingIcons.length > 0) {
  console.error(
    `\nMissing icon files: ${missingIcons.join(', ')}\n` +
    'Run `npm run generate-icons` first.\n'
  );
  process.exit(1);
}

// Build the zip using the system zip command (available on macOS and Linux).
// For cross-platform support, consider replacing with the 'archiver' package.
const includeArgs = INCLUDE.join(' ');
const excludeArgs = buildExcludeArgs();

const command =
  `cd "${ROOT}" && zip -r "${ZIP_PATH}" ${includeArgs} ${excludeArgs}`;

console.log(`Packaging v${VERSION}…`);

try {
  execSync(command, { stdio: 'inherit' });
  const stat = fs.statSync(ZIP_PATH);
  const kb = (stat.size / 1024).toFixed(1);
  console.log(`\n✓ Package ready: dist/${ZIP_NAME} (${kb} KB)`);
  console.log('\nUpload this file at: https://chrome.google.com/webstore/devconsole');
} catch (err) {
  console.error('\nPackaging failed:', err.message);
  console.error('Ensure the `zip` command is available on your PATH.');
  process.exit(1);
}
