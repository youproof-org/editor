# editor
VS Code extension for editing YAML content files for youproof.org

## Settings

- `youproof.contentRoot`: the content repo's `content/` directory. Absolute, or relative to the workspace root.
- `youproof.servicesRoot`: a services checkout. The editor reads its locales from `apps/website/lib/i18n/locales.json` and the entity label variants from `apps/website/lib/i18n/entity-labels.json`, at startup and on every content reload. Absolute, or relative to the workspace root. When unset, it is `<contentRoot>/../../services`, a `services` folder beside the content repo.
- `youproof.defaultLocale`: the locale loaded on startup. It must be one of the locales in `locales.json`; any other value is an error and no content loads. When unset, the first locale in `locales.json` is used.

## Building

The extension bundles two packages from a services checkout, `@youproof.org/content-model` and `@youproof.org/display-templates` (`packages/*/src` there), so building needs one. The build looks in `SERVICES_DIR` when it is set, and otherwise in a `services` folder beside this repo, and stops with an error naming the path when the packages aren't there. This is separate from `youproof.servicesRoot`, which is where the installed extension reads its data at runtime.

- `npm run typecheck`: `tsc` over `src/` and the two packages.
- `npm run build`: type-checks, then bundles `out/extension.js`, `media/panel.js` and `media/editor.js` with esbuild.
- `npm test`: type-checks, bundles, and runs `test/*.test.mjs` against `out/test/host.js`.
- `npm run test:ui`: bundles, and runs `test/ui/*.ui.test.mjs`, which drive the real `media/editor.js` and `media/panel.js` in headless Chromium against the real extension (`out/extension.js`), with `test/ui/vscodeFake.mjs` standing in for VS Code and its editor tabs, on a copy of the small content tree in `test/ui/fixture/content`. It needs Playwright's Chromium (`npx playwright install chromium`) and takes about half a minute. With `YOUPROOF_CONTENT_DIR` set to a content checkout it also saves every real file unedited through the webview, which takes about six minutes.
- `npm run release`: also requires the services checkout to be clean, and names its commit in the release notes.

A new template or label variant reaches the editor through the content and services data it reads at runtime. A change to the packages themselves, such as a new builtin, reaches it only in a new editor build.
