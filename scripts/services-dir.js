'use strict';

/**
 * Where the build finds the services checkout whose packages it bundles:
 * SERVICES_DIR when set (the same variable the content repo's scripts read),
 * otherwise a `services` folder beside this repo. This is build-time only; the
 * running extension finds its services data through the youproof.servicesRoot
 * setting instead.
 */

const fs = require('fs');
const path = require('path');

const SERVICES_DIR_ENV = 'SERVICES_DIR';
const extensionDir = path.resolve(__dirname, '..');
const DEFAULT_SERVICES_DIR = path.resolve(extensionDir, '..', 'services');

const PACKAGES = {
  '@youproof.org/content-model': path.join('packages', 'content-model', 'src', 'index.ts'),
  '@youproof.org/display-templates': path.join('packages', 'display-templates', 'src', 'index.ts'),
};

function servicesDir() {
  const configured = process.env[SERVICES_DIR_ENV]?.trim();
  return configured ? path.resolve(configured) : DEFAULT_SERVICES_DIR;
}

/** The package name → entry file map for the services checkout, or an Error saying what is missing. */
function servicesPackages() {
  const dir = servicesDir();
  const entries = Object.fromEntries(Object.entries(PACKAGES).map(([name, rel]) => [name, path.join(dir, rel)]));
  const missing = Object.entries(entries).filter(([, file]) => !fs.existsSync(file));
  if (missing.length > 0) {
    const source = process.env[SERVICES_DIR_ENV]?.trim()
      ? `${SERVICES_DIR_ENV} is '${process.env[SERVICES_DIR_ENV]}'`
      : `${SERVICES_DIR_ENV} is unset, so the default beside this repo is used`;
    throw new Error(
      `the editor bundles ${missing.map(([name]) => name).join(' and ')} from a services checkout, ` +
        `but ${missing.map(([, file]) => file).join(' and ')} ${missing.length > 1 ? 'do' : 'does'} not exist ` +
        `(${source}). Clone https://github.com/youproof-org/services to ${DEFAULT_SERVICES_DIR}, ` +
        `or set ${SERVICES_DIR_ENV} to a services checkout.`,
    );
  }
  return { dir, entries };
}

module.exports = { SERVICES_DIR_ENV, DEFAULT_SERVICES_DIR, extensionDir, servicesDir, servicesPackages };
