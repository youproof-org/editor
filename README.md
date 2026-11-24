# editor
VS Code extension for editing YAML content files for youproof.org

## Settings

- `youproof.contentRoot`: the content repo's `content/` directory. Absolute, or relative to the workspace root.
- `youproof.servicesRoot`: a services checkout. The editor reads its locales from `apps/website/lib/i18n/locales.json` and the entity label variants from `apps/website/lib/i18n/entity-labels.json`, at startup and on every content reload. Absolute, or relative to the workspace root. When unset, it is `<contentRoot>/../../services`, a `services` folder beside the content repo.
- `youproof.defaultLocale`: the locale loaded on startup. It must be one of the locales in `locales.json`; any other value is an error and no content loads. When unset, the first locale in `locales.json` is used.
