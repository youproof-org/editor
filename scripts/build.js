'use strict';

/**
 * Bundles the extension host and the two webviews with esbuild, resolving the
 * shared @youproof.org packages from the services checkout (see services-dir.js).
 *
 *   node scripts/build.js            out/extension.js, media/panel.js, media/editor.js
 *   node scripts/build.js --tests    the same, plus out/test/host.js for test/*.test.mjs
 *
 * Type checking is separate (scripts/typecheck.js); esbuild only strips types.
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { extensionDir, servicesPackages } = require('./services-dir');

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

let alias;
try {
  alias = servicesPackages().entries;
} catch (err) {
  fail(err.message);
}

const at = (rel) => path.join(extensionDir, rel);

// js-yaml stays a runtime dependency loaded from node_modules, as before bundling.
const host = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode', 'js-yaml'],
  sourcemap: true,
  alias,
  logLevel: 'warning',
};

const webview = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  sourcemap: true,
  alias,
  logLevel: 'warning',
};

const builds = [
  { ...host, entryPoints: [at('src/extension.ts')], outfile: at('out/extension.js') },
  { ...webview, entryPoints: [at('media/src/sidebar/index.tsx')], outfile: at('media/panel.js') },
  { ...webview, entryPoints: [at('media/src/editor/index.tsx')], outfile: at('media/editor.js') },
];
if (process.argv.includes('--tests')) {
  builds.push({ ...host, entryPoints: [at('test/host.ts')], outfile: at('out/test/host.js') });
}

fs.rmSync(at('out'), { recursive: true, force: true });

Promise.all(builds.map((options) => esbuild.build(options))).catch(() => fail('esbuild reported errors (above).'));
