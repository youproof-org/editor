'use strict';

/**
 * Type-checks the extension host with tsc, including the @youproof.org packages it
 * imports from the services checkout. tsconfig.json maps them to the default
 * services folder beside this repo, which is what editors and the IDE see. When
 * SERVICES_DIR points elsewhere, a generated config extends it with that location.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DEFAULT_SERVICES_DIR, extensionDir, servicesPackages } = require('./services-dir');

let services;
try {
  services = servicesPackages();
} catch (err) {
  console.error(`typecheck: ${err.message}`);
  process.exit(1);
}

let project = path.join(extensionDir, 'tsconfig.json');
if (services.dir !== DEFAULT_SERVICES_DIR) {
  const dir = path.join(extensionDir, 'out', 'typecheck');
  fs.mkdirSync(dir, { recursive: true });
  project = path.join(dir, 'tsconfig.json');
  const paths = Object.fromEntries(Object.entries(services.entries).map(([name, file]) => [name, [file]]));
  fs.writeFileSync(project, JSON.stringify({ extends: '../../tsconfig.json', compilerOptions: { paths } }, null, 2));
}

try {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', project], { cwd: extensionDir, stdio: 'inherit' });
} catch {
  process.exit(1);
}
