// Where the site would reject or change what a panel shows: errors, reloads,
// numbering, the figure self-reference, and saving.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { closeBrowser, FIXTURE, openSession, waitFor } from './session.mjs'
import { clickAt, fieldWith, pause, save, tokenTexts, touchAndSave } from './helpers.mjs'

after(closeBrowser)
const fresh = async (t) => { const session = await openSession(); t.after(() => session.close()); return session }
const TEMPLATES = 'display-templates/display-templates.hu.yaml'
const errorTokens = (scope) => scope.locator('.cm-yp-ref-error').evaluateAll((els) => els.map((el) => [el.innerText, el.dataset.tip]))

test('a reference in a formula\'s content, inside $...$, or with a damaged payload shows as an error with the reason', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const lead = await fieldWith(page, 'Ekkor')
  await clickAt(lead, 'Ekkor', { after: true })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Meta+c')
  const content = await fieldWith(page, 'a^2 + b^2')
  await clickAt(content, 'c^2', { after: true })
  await page.keyboard.press('Meta+v'); await pause(page)
  const [inFormula] = await errorTokens(content)
  assert.match(inFormula[1], /reads no references in this field/)
  await clickAt(lead, 'Ekkor', { after: true })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('$')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('$')
  const [inMath] = await errorTokens(lead)
  assert.match(inMath[1], /inside \$\.\.\.\$/)
  const color = await lead.locator('.cm-yp-ref-error').evaluate((el) => getComputedStyle(el).textDecorationStyle)
  assert.equal(color, 'wavy')
  await page.keyboard.press('Meta+z'); await page.keyboard.press('Meta+z'); await pause(page)
  await page.keyboard.insertText(' [@zz]')
  const damaged = await errorTokens(lead)
  assert.ok(damaged.some(([, reason]) => /damaged/.test(reason)), JSON.stringify(damaged))
})

test('a broken templates file shows its problem in a pop-up and in the references, and fixing it brings them back in the open panel', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const good = s.read(TEMPLATES)
  s.write(TEMPLATES, good.replace(/the-index-label:\n  targets: \[definition, theorem\]\n  template: '[^\n]*'\n/, ''))
  await waitFor(async () => (await errorTokens(page)).length > 0)
  assert.ok((await errorTokens(page)).some(([, reason]) => /the-index-label/.test(reason)))
  s.write(TEMPLATES, 'the-index-label: [unclosed\n')
  await waitFor(() => s.errors.some((message) => /display-templates\.hu\.yaml/.test(message)))
  s.write(TEMPLATES, good)
  await waitFor(async () => (await errorTokens(page)).length === 0)
  assert.equal((await tokenTexts(page))[3], 'az [1.2. Tétel]')
})

test('a broken entity label registry shows its error on every reference once the content is reloaded', async (t) => {
  const s = await fresh(t)
  await s.open('Prímek')
  writeFileSync(s.servicesFile('entity-labels.json'), '{ not json')
  await s.request('reloadModel', {})
  const page = await s.open('Prímek')
  const errors = await errorTokens(page)
  assert.equal(errors.length, 10)
  assert.ok(errors.every(([, reason]) => /registry/.test(reason)), JSON.stringify(errors[0]))
  assert.ok(s.errors.some((message) => /entity-labels\.json/.test(message)))
})

test('reordering embeds and saving renumbers the references in another open panel', async (t) => {
  const s = await fresh(t)
  const primek = await s.open('Prímek', { permanent: true })
  const tetelek = await s.open('Tételek', { permanent: true })
  const before = (await tokenTexts(primek))[3]
  assert.equal(before, 'az [1.2. Tétel]')
  await tetelek.locator('.block').nth(1).locator('button[title="Move down"]').click()
  await tetelek.locator('.block').nth(2).locator('button[title="Move down"]').click()
  await save(tetelek)
  await waitFor(async () => (await tokenTexts(primek))[3] !== before)
  assert.equal((await tokenTexts(primek))[3], 'az [1.3. Tétel]')
})

test('the sidebar tree has no items for references', async (t) => {
  const s = await fresh(t)
  const types = new Set((await s.tree()).map((item) => item.type))
  assert.deepEqual([...types].filter((type) => /ref/i.test(type)), [])
  assert.ok(!(await s.sidebar.locator('body').innerText()).includes('[osztó]'))
})

test('a figure\'s [*] shows the figure\'s self-reference as one unit, follows its display, and saves as [*]', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const lead = await fieldWith(page, 'Ahogy')
  assert.equal(await lead.locator('.cm-yp-ref-self').innerText(), 'az [1.1. ábrán]')
  await clickAt(lead, ' látható')
  await page.keyboard.press('Backspace')
  assert.equal(await lead.locator('.cm-yp-ref-self').count(), 0, 'Backspace removes it whole')
  await page.keyboard.press('Meta+z'); await pause(page)
  assert.equal(await lead.locator('.cm-yp-ref-self').count(), 1)
  await clickAt(lead, 'Ahogy ', { after: true })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('X')
  assert.match(await lead.innerText(), /^Ahogy az \[1\.1\. ábrán\]X látható/, 'the caret steps over it')
  await page.keyboard.press('Backspace')
  const display = page.locator('.field-input').first()
  await display.fill('[Ábra]')
  await waitFor(async () => (await lead.locator('.cm-yp-ref-self').innerText()) === '[Ábra]')
  await display.fill('')
  await waitFor(async () => (await lead.locator('.cm-yp-ref-self').getAttribute('class')).includes('error'))
  await display.fill('{the(target.index)} [{target.index} ábrán]')
  await save(page)
  assert.match(s.read('books/konyv/01-resz/01-egy/01-primek.yaml'), /lead-in: 'Ahogy \[\*\] látható, \[5\] így néz ki\.'/)
})

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))

test('saving an unedited panel through the webview writes every file byte for byte, a file folded at another width too', async (t) => {
  const s = await fresh(t)
  const owners = (await s.tree()).filter((item) => ['chapter', 'section', 'definition', 'theorem', 'proof'].includes(item.type))
  const before = Object.fromEntries(walk(s.root).map((file) => [file, readFileSync(file, 'utf8')]))
  let saved = 0
  for (const { label } of owners) {
    const page = await s.open(label)
    if (await page.locator('.node-view .cm-content').count() === 0) continue
    await touchAndSave(page, page.locator('.node-view .cm-content').first())
    saved++
  }
  const changed = Object.keys(before).filter((file) => readFileSync(file, 'utf8') !== before[file]).map((file) => path.relative(s.root, file))
  assert.deepEqual(changed, [])
  assert.equal(saved, 8)
  assert.match(readFileSync(path.join(FIXTURE, 'books/konyv/01-resz/01-egy/01-primek.yaml'), 'utf8'), /mint ahogy az\n/, 'the fixture folds a paragraph short of 120 columns')
})

const realContent = process.env.YOUPROOF_CONTENT_DIR

test('saving every real content file unedited through the webview keeps it byte for byte', {
  skip: !realContent && 'set YOUPROOF_CONTENT_DIR to a content checkout; it takes about six minutes',
  timeout: 3_600_000,
}, async (t) => {
  const session = await openSession({ content: path.resolve(realContent) })
  t.after(() => session.close())
  const owners = (await session.tree()).filter((item) => ['chapter', 'section', 'definition', 'theorem', 'proof', 'remark'].includes(item.type))
  const before = Object.fromEntries(walk(session.root).map((file) => [file, readFileSync(file, 'utf8')]))
  let saved = 0
  for (const { id } of owners) {
    const page = await session.openId(id)
    if (await page.locator('.node-view .cm-content').count() > 0) {
      await touchAndSave(page, page.locator('.node-view .cm-content').first())
      saved++
    }
    session.fake.closeTabs()
  }
  const changed = Object.keys(before).filter((file) => readFileSync(file, 'utf8') !== before[file]).map((file) => path.relative(session.root, file))
  t.diagnostic(`${saved} of ${owners.length} panels saved, ${changed.length} files changed`)
  assert.deepEqual(changed, [])
})
