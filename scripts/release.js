'use strict';

/**
 * Builds the extension, packages it as a VSIX, tags the current commit, and
 * publishes a GitHub Release with the VSIX attached.
 *
 * Run with:  npm run release
 *
 * The version comes from package.json — there is no argument. To cut a release,
 * bump "version" in package.json in a normal commit first, then run this on the
 * stable/released branch.
 *
 * Identity note: package.json carries the npm identity
 * (name "@youproof.org/editor", publisher "youproof.org"). vsce rejects scoped
 * names, so this script temporarily rewrites name -> "editor" and
 * publisher -> "youproof-org" (extension id "youproof-org.editor") only while
 * running vsce, then restores the file exactly. The swap is never committed and
 * never reaches the git tag, so the GitHub source tarball keeps the npm identity.
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RELEASE_BRANCH = 'stable/released';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

const extensionDir = path.resolve(__dirname, '..');
const pkgPath = path.join(extensionDir, 'package.json');

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function run(command) {
  execSync(command, { cwd: extensionDir, stdio: 'inherit' });
}

function capture(command) {
  return execSync(command, { cwd: extensionDir, encoding: 'utf-8' }).trim();
}

// ─── 1. Read & validate version ────────────────────────────────────────────────

const originalPkgText = fs.readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(originalPkgText);
const version = pkg.version;

if (!version || !SEMVER.test(version)) {
  fail(`package.json version "${version}" is not valid semver (e.g. 1.2.3, no leading 'v').`);
}
const tag = `v${version}`;
const vsixFile = `youproof-editor-${version}.vsix`;

// ─── 2. Branch guard ───────────────────────────────────────────────────────────

const branch = capture('git rev-parse --abbrev-ref HEAD');
if (branch !== RELEASE_BRANCH) {
  fail(`releases are only allowed on "${RELEASE_BRANCH}" (current branch: "${branch}").`);
}

// ─── 3. Clean tree guard ───────────────────────────────────────────────────────
// The VSIX is built from the working tree but the tag points at HEAD — they must match.

if (capture('git status --porcelain') !== '') {
  fail('working tree is dirty. Commit or stash your changes before releasing.');
}

// ─── 4. In-sync-with-origin guard ──────────────────────────────────────────────
// Refresh origin's branch refs and tags, then require HEAD to match
// origin/stable/released so we never release a commit that isn't on the official
// remote branch (the tag push alone would not advance the branch ref).

run('git fetch origin --tags --quiet');

let remoteHead;
try {
  remoteHead = capture(`git rev-parse origin/${RELEASE_BRANCH}`);
} catch {
  fail(`origin/${RELEASE_BRANCH} not found — push the branch first.`);
}
if (capture('git rev-parse HEAD') !== remoteHead) {
  fail(`HEAD is not in sync with origin/${RELEASE_BRANCH}. Push (and merge) your commits first.`);
}

// ─── 5. Duplicate-version guard ────────────────────────────────────────────────

const existingTags = capture('git tag --list').split('\n');
if (existingTags.includes(tag)) {
  fail(`tag "${tag}" already exists. Bump the version in package.json.`);
}
try {
  execSync(`gh release view ${tag}`, { cwd: extensionDir, stdio: 'ignore' });
  fail(`a GitHub release "${tag}" already exists. Bump the version in package.json.`);
} catch (err) {
  // `gh release view` exits non-zero when the release does not exist — that's what we want.
  // Re-throw only if it was our own fail() that called process.exit (it won't reach here).
}

// ─── 6. Build ──────────────────────────────────────────────────────────────────

console.log(`release: building ${tag}…`);
run('npm run build');

// ─── 7. Package VSIX (with temporary name/publisher swap) ──────────────────────

console.log('release: packaging VSIX…');
try {
  const swapped = { ...pkg, name: 'editor', publisher: 'youproof-org' };
  fs.writeFileSync(pkgPath, JSON.stringify(swapped, null, 2) + '\n');
  run(`npx vsce package --out ${vsixFile}`);
} finally {
  // Always restore the exact original package.json — the swap must never be committed.
  fs.writeFileSync(pkgPath, originalPkgText);
}

// ─── 8. Tag the current commit ─────────────────────────────────────────────────

console.log(`release: tagging ${tag}…`);
execFileSync('git', ['tag', tag], { cwd: extensionDir, stdio: 'inherit' });
execFileSync('git', ['push', 'origin', tag], { cwd: extensionDir, stdio: 'inherit' });

// ─── 9. Publish GitHub Release ─────────────────────────────────────────────────

console.log('release: creating GitHub release…');
const head = capture('git rev-parse HEAD');
execFileSync('gh', [
  'release', 'create', tag, vsixFile,
  '--title', tag,
  '--target', head,
  '--generate-notes',
], { cwd: extensionDir, stdio: 'inherit' });

console.log(`release: done — ${tag} published with ${vsixFile}.`);
