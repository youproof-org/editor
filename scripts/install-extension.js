'use strict';

/**
 * Compiles the extension and symlinks it into ~/.vscode/extensions/ so VS Code
 * loads it as a permanently installed extension.
 *
 * Runs automatically as the `postinstall` npm lifecycle hook.
 * Safe to run multiple times — detects when nothing has changed.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Resolve paths ────────────────────────────────────────────────────────────

const extensionDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf-8'));

const extensionId = `${pkg.publisher}.${pkg.name}-${pkg.version}`;
const vsCodeExtensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
const targetLink = path.join(vsCodeExtensionsDir, extensionId);

// ─── Compile TypeScript ───────────────────────────────────────────────────────

console.log('youproof-editor: compiling TypeScript…');
try {
  execSync('npm run compile', { cwd: extensionDir, stdio: 'inherit' });
} catch {
  console.error('youproof-editor: TypeScript compilation failed — extension not installed.');
  process.exit(1);
}

// ─── Signal reload ────────────────────────────────────────────────────────────
// Writes a sentinel file that a running VS Code instance watches for. The extension
// host compares the file's mtime against its own activation time: if the file is
// newer, it prompts the user to reload and pick up the freshly compiled output.
try {
  fs.writeFileSync(path.join(extensionDir, '.needs-reload'), String(Date.now()));
} catch { /* non-fatal */ }

// ─── Install symlink ──────────────────────────────────────────────────────────

if (!fs.existsSync(vsCodeExtensionsDir)) {
  console.warn(`youproof-editor: VS Code extensions directory not found at ${vsCodeExtensionsDir}`);
  console.warn('  Install VS Code and open it at least once, then re-run npm install.');
  process.exit(0);
}

// Check if anything already exists at the target path (follows or not follows symlinks).
const targetExists = (() => { try { fs.lstatSync(targetLink); return true; } catch { return false; } })();

if (targetExists) {
  // If it is a symlink pointing to this directory already, nothing to do.
  try {
    const existing = fs.realpathSync(targetLink);
    if (existing === fs.realpathSync(extensionDir)) {
      console.log(`youproof-editor: already installed at ${targetLink} — nothing to do.`);
      console.log('  Recompile with "npm run compile" and reload VS Code to pick up changes.');
      process.exit(0);
    }
  } catch { /* broken symlink or different target — fall through to recreate */ }

  // Different target (old version, stale/broken link, or plain directory) — remove it.
  fs.rmSync(targetLink, { recursive: true, force: true });
}

// Remove any other installed versions of this extension (different semver).
try {
  const prefix = `${pkg.publisher}.${pkg.name}-`;
  for (const entry of fs.readdirSync(vsCodeExtensionsDir)) {
    if (entry.startsWith(prefix) && entry !== extensionId) {
      console.log(`youproof-editor: removing old version ${entry}…`);
      fs.rmSync(path.join(vsCodeExtensionsDir, entry), { recursive: true, force: true });
    }
  }
} catch { /* non-fatal */ }

// Create the symlink.
// On Windows, use 'junction' — directory junctions don't require administrator rights.
const symlinkType = process.platform === 'win32' ? 'junction' : undefined;
try {
  fs.symlinkSync(extensionDir, targetLink, symlinkType);
} catch (err) {
  console.error(`youproof-editor: failed to create symlink at ${targetLink}`);
  console.error(`  ${err.message}`);
  process.exit(1);
}

console.log(`youproof-editor: installed → ${targetLink}`);
console.log('  Reload VS Code (or fully restart it) to activate the extension.');
