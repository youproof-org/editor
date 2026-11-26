// The editor reads its locales and entity label variants from a services
// checkout instead of keeping copies. These pin how that checkout is found, what
// is read from it, and what happens when a file is missing or malformed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Module from 'node:module'

const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return {}
  return realLoad.call(this, request, ...rest)
}

const {
  readServicesData, resolveServicesRoot, ServicesDataError, LOCALES_FILE, ENTITY_LABELS_FILE,
  entityLabelFields,
} = await import('../out/test/host.js')

const LOCALES = { locales: { xx: { displayName: 'Xx' }, yy: { displayName: 'Yy' } } }

const form = (word, suffix) => ({ canonical: word, cases: { c1: { base: word, suffix } } })
const single = (key, word) => ({ default: key, variants: { [key]: form(word, '-x') } })
const localeLabels = () => ({
  cases: ['c1'],
  definition: single('plain', 'meghatározás'),
  theorem: { default: 'main', variants: { main: form('főszó', '-a'), minor: form('mellék', '-b') } },
  proof: single('only', 'egyetlen'),
  remark: single('note', 'jegyzet'),
})
const REGISTRY = { xx: localeLabels(), yy: localeLabels() }

function servicesDir({ locales = LOCALES, registry = REGISTRY } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'yp-services-'))
  mkdirSync(path.join(root, path.dirname(LOCALES_FILE)), { recursive: true })
  const write = (file, data) => {
    if (data === null) return
    writeFileSync(path.join(root, file), typeof data === 'string' ? data : JSON.stringify(data))
  }
  write(LOCALES_FILE, locales)
  write(ENTITY_LABELS_FILE, registry)
  return root
}

test('servicesRoot defaults to a services folder beside the content repo', () => {
  const contentRoot = path.join('/repos', 'content', 'content')
  assert.equal(resolveServicesRoot(undefined, '/ws', contentRoot), path.join('/repos', 'services'))
  assert.equal(resolveServicesRoot('  ', '/ws', contentRoot), path.join('/repos', 'services'))
  assert.equal(resolveServicesRoot('../svc', '/ws/content', contentRoot), path.join('/ws', 'svc'))
  assert.equal(resolveServicesRoot('/abs/svc', '/ws', contentRoot), '/abs/svc')
})

test('locales and label variants are read from the services checkout', () => {
  const data = readServicesData(servicesDir())
  assert.deepEqual(data.localeConfig, { locales: ['xx', 'yy'], defaultLocale: 'xx' })
  assert.equal(data.entityLabelsError, undefined)
  assert.deepEqual(data.entityLabels.xx.cases, ['c1'])
  assert.deepEqual(data.entityLabels.xx.theorem.variants.minor, { canonical: 'mellék', cases: { c1: { base: 'mellék', suffix: '-b' } } })
})

test('the webview gets each variant as a key and its canonical word', () => {
  const fields = entityLabelFields({ type: 'theorem', locale: 'xx' }, readServicesData(servicesDir()))
  assert.deepEqual(fields.labelVariants, {
    default: 'main',
    variants: [{ key: 'main', canonical: 'főszó' }, { key: 'minor', canonical: 'mellék' }],
  })
})

test('a registry the site build would reject is reported with what is wrong', () => {
  const registry = { xx: localeLabels(), yy: localeLabels() }
  delete registry.yy.theorem.variants.minor.cases.c1
  registry.zz = localeLabels()
  const root = servicesDir({ registry })
  const data = readServicesData(root)
  assert.equal(data.entityLabels, null)
  assert.ok(data.entityLabelsError.includes(path.join(root, ENTITY_LABELS_FILE)), data.entityLabelsError)
  assert.match(data.entityLabelsError, /yy\.theorem\.minor: missing case 'c1'/)
  assert.match(data.entityLabelsError, /'zz' is not a configured locale/)
})

test('entity data carries the variants for its own locale and type', () => {
  const services = readServicesData(servicesDir())
  const fields = entityLabelFields({ type: 'theorem', locale: 'xx', label: 'minor' }, services)
  assert.equal(fields.label, 'minor')
  assert.deepEqual(fields.labelVariants.variants.map((v) => v.key), ['main', 'minor'])
  assert.equal(entityLabelFields({ type: 'theorem', locale: 'zz' }, services).labelVariants, undefined)
})

test('a missing locales.json is an error naming the path and the setting', () => {
  const root = servicesDir({ locales: null })
  assert.throws(() => readServicesData(root), (err) => {
    assert.ok(err instanceof ServicesDataError)
    assert.ok(err.message.includes(path.join(root, LOCALES_FILE)), err.message)
    assert.match(err.message, /youproof\.servicesRoot/)
    return true
  })
})

test('a locales.json with no locales is an error too, not a silent fallback', () => {
  assert.throws(() => readServicesData(servicesDir({ locales: { locales: {} } })), ServicesDataError)
  assert.throws(() => readServicesData(servicesDir({ locales: '{ not json' })), ServicesDataError)
})

test('a missing or malformed registry leaves locales loaded and reports the path', () => {
  for (const registry of [null, '{ not json', { xx: { theorem: { default: 'main' } } }, { xx: null }]) {
    const root = servicesDir({ registry })
    const data = readServicesData(root)
    assert.deepEqual(data.localeConfig.locales, ['xx', 'yy'])
    assert.equal(data.entityLabels, null)
    assert.ok(data.entityLabelsError.includes(path.join(root, ENTITY_LABELS_FILE)), data.entityLabelsError)
    const fields = entityLabelFields({ type: 'theorem', locale: 'xx', hasLabelsBlock: true }, data)
    assert.equal(fields.labelVariants, undefined)
    assert.equal(fields.hasLabelsBlock, true)
    assert.match(fields.labelRegistryError, /youproof\.servicesRoot/)
  }
})

test('youproof.defaultLocale picks the startup locale when it is configured', () => {
  assert.equal(readServicesData(servicesDir(), 'yy').localeConfig.defaultLocale, 'yy')
})

test('an unset youproof.defaultLocale falls to the first configured locale', () => {
  assert.equal(readServicesData(servicesDir(), undefined).localeConfig.defaultLocale, 'xx')
  assert.equal(readServicesData(servicesDir(), '').localeConfig.defaultLocale, 'xx')
})

test('a youproof.defaultLocale that is not configured is an error naming it and the locales', () => {
  assert.throws(() => readServicesData(servicesDir(), 'zz'), (err) => {
    assert.ok(err instanceof ServicesDataError)
    assert.match(err.message, /youproof\.defaultLocale is 'zz'/)
    assert.match(err.message, /xx, yy/)
    return true
  })
})
