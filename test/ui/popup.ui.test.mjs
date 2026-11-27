// The reference popup: creating and editing references, its lists, its
// placement, and opening a target from it.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { closeBrowser, openSession, waitFor } from './session.mjs'
import { clickAt, fieldWith, pause, save, tokenTexts } from './helpers.mjs'

after(closeBrowser)
const fresh = async (t) => { const session = await openSession(); t.after(() => session.close()); return session }
const PRIMEK = 'books/konyv/01-resz/01-egy/01-primek.yaml'
const LISTAK = 'books/konyv/01-resz/02-ketto/01-listak.yaml'
const popup = (page) => page.locator('.ref-popup')
const selected = (page) => page.locator('.ref-popup-row--selected').innerText()

async function expandSidebar(sidebar) {
  for (let i = 0; i < 20; i++) {
    const closed = sidebar.locator('.chevron:not(.expanded)')
    if (await closed.count() === 0) return
    await closed.first().click()
  }
}

test('[ then a term and Enter inserts the reference, a save writes it at its place in the list, and one undo removes it', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const field = await fieldWith(page, 'csak eggyel')
  await clickAt(field, 'csak eggyel', { after: true })
  await page.keyboard.type(' [prím')
  assert.equal(await page.locator('.ref-popup-input').inputValue(), 'prím', 'every letter landed in the search box')
  assert.ok(!(await field.innerText()).includes('eggyel [') && !(await field.innerText()).includes('eggyel prím'), 'none in the text')
  await page.locator('.ref-popup-row--selected').waitFor()
  await page.keyboard.press('Enter'); await pause(page)
  assert.equal(await popup(page).count(), 0)
  assert.deepEqual((await tokenTexts(field)).slice(0, 2), ['[prím]', '[prím]'])
  assert.match(await field.innerText(), /csak eggyel \[prím\] és önmagával/)
  await page.keyboard.press('Meta+z'); await pause(page)
  assert.doesNotMatch(await field.innerText(), /eggyel \[prím\]/)
  await page.keyboard.press('Meta+Shift+z'); await pause(page)
  await save(page)
  const list = s.read(PRIMEK).split('body:')[0]
  assert.match(list, /references:\n  - \{ text: '\[prím\]', target: definitions\.prim\.terms\.prime \}\n  - \{ text: prím, target: definitions\.prim\.terms\.prime \}\n  - \{ text: '\[prím\]', target: definitions\.prim\.terms\.prime \}\n/)
  assert.match(s.read(PRIMEK), /Egy \[0\] szám csak eggyel \[1\] és önmagával osztható\. Ha \$n\$ \*\*\*\[2\]hatvány/)
})

test('[ types a plain [ inside $...$, inside ^...^ and after an unclosed $, and nowhere opens the popup there', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const field = await fieldWith(page, 'Egy gépelt')
  for (const [typed, back, shows] of [[' $x$', 1, '$x[$'], [' ^x^', 1, '^x[^'], [' $x', 0, '$x[']]) {
    await clickAt(field, 'szöveg:', { after: true })
    await page.keyboard.type(typed)
    for (let i = 0; i < back; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('[')
    assert.equal(await popup(page).count(), 0, shows)
    assert.ok((await field.innerText()).includes(shows), await field.innerText())
    await page.keyboard.press('Meta+z'); await pause(page)
    while ((await field.innerText()) !== 'Egy gépelt szöveg:') { await page.keyboard.press('Meta+z'); await pause(page, 30) }
  }
})

test('[[ in a definition makes a term marker; in a section the second [ does nothing', async (t) => {
  const s = await fresh(t)
  const definition = await s.open('Prím')
  const term = await fieldWith(definition, 'Egy szám')
  await clickAt(term, 'osztható.', { after: true })
  await definition.keyboard.type(' [[')
  assert.equal(await popup(definition).count(), 0)
  assert.match(await term.innerText(), /osztható\. \[\[\]\]$/)
  const section = await s.open('Prímek')
  const field = await fieldWith(section, 'csak eggyel')
  await clickAt(field, 'csak eggyel', { after: true })
  await section.keyboard.type(' [[')
  assert.equal(await section.locator('.ref-popup-input').inputValue(), '')
  assert.equal(await popup(section).count(), 1)
})

test('in a figure lead-in [ then * inserts [*], shown as the figure\'s self-reference', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const lead = await fieldWith(page, 'Ahogy')
  await clickAt(lead, 'így néz ki.', { after: true })
  await page.keyboard.type(' Lásd [*')
  assert.equal(await popup(page).count(), 0)
  assert.deepEqual(await lead.locator('.cm-yp-ref-self').allInnerTexts(), ['az [1.1. ábrán]', 'az [1.1. ábrán]'])
})

test('a theorem reference: search by number, choose a template with its preview at the caret, and the list keeps the selection in view', async (t) => {
  process.env.YOUPROOF_UI_HEIGHT = '360'
  t.after(() => { delete process.env.YOUPROOF_UI_HEIGHT })
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const field = await fieldWith(page, 'Egy gépelt')
  await clickAt(field, 'Egy gépelt', { after: true })
  await page.keyboard.type(' [1.2.')
  await page.locator('.ref-popup-row--selected').waitFor()
  while (!/alaptétele/.test(await selected(page))) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter'); await pause(page, 200)
  assert.equal(await page.locator('.ref-popup-row--selected .ref-popup-name').innerText(), 'the-index-label', 'the template most used for a theorem comes first')
  while (await page.locator('.ref-popup-row--selected .ref-popup-name').innerText() !== 'the-index-label-ine') await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator('.cm-yp-ref-ghost').innerText(), 'az [1.2. Tétel]ben', 'the draft shows at the caret')
  const visible = () => page.evaluate(() => {
    const row = document.querySelector('.ref-popup-row--selected')
    const r = row.getBoundingClientRect(), l = row.closest('.ref-popup-list').getBoundingClientRect(), p = row.closest('.ref-popup').getBoundingClientRect()
    return r.top >= Math.max(l.top, p.top) - 1 && r.bottom <= Math.min(l.bottom, p.bottom) + 1
  })
  const rows = await page.locator('.ref-popup-list .ref-popup-row').count()
  for (let i = 0; i < rows; i++) {
    await page.keyboard.press('ArrowDown')
    assert.ok(await visible(), `row ${i + 1} of ${rows} in view going down`)
  }
  for (let i = 0; i < rows; i++) {
    await page.keyboard.press('ArrowUp')
    assert.ok(await visible(), `row ${rows - i - 1} in view going up`)
  }
  while (await page.locator('.ref-popup-row--selected .ref-popup-name').innerText() !== 'the-index-label-ine') await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter'); await pause(page)
  assert.match(await field.innerText(), /Egy gépelt az \[1\.2\. Tétel\]ben szöveg:/)
})

test('Tab on a term hit opens Text mode with the term\'s text, and a selected word is the search and the link text', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const field = await fieldWith(page, 'Egy gépelt')
  await clickAt(field, 'Egy gépelt', { after: true })
  await page.keyboard.type(' [prím')
  await page.locator('.ref-popup-row--selected').waitFor()
  await page.keyboard.press('Tab'); await pause(page)
  assert.equal(await page.locator('.ref-popup-mode--on').innerText(), 'Text')
  assert.equal(await page.locator('.ref-popup-section .ref-popup-input').inputValue(), 'prím')
  await page.keyboard.press('Escape')
  await clickAt(field, 'gépelt')
  await page.keyboard.down('Shift')
  for (let i = 0; i < 'gépelt'.length; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.up('Shift')
  await page.keyboard.type('[')
  assert.equal(await page.locator('.ref-popup-input').inputValue(), 'gépelt')
  await page.keyboard.press('Escape')
})

test('a URL with link text of its own', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const field = await fieldWith(page, 'Egy gépelt')
  await clickAt(field, 'szöveg:', { after: true })
  await page.keyboard.type(' [')
  await page.keyboard.insertText('https://hu.wikipedia.org/wiki/Prímszám')
  await page.locator('.ref-popup-row--selected').waitFor()
  await page.keyboard.press('Enter'); await pause(page)
  assert.equal(await page.locator('.ref-popup-mode--on').innerText(), 'Text')
  await page.locator('.ref-popup-section .ref-popup-input').fill('[Wikipedia]')
  await page.keyboard.press('Enter'); await pause(page)
  assert.match(await field.innerText(), /szöveg: \[Wikipedia\]$/)
  await page.locator('.cm-yp-ref-link', { hasText: 'Wikipedia' }).hover()
  await page.waitForSelector('.yp-tip:not([hidden])')
  assert.equal(await page.locator('.yp-tip').innerText(), 'https://hu.wikipedia.org/wiki/Prímszám')
})

test('a target picked in the sidebar fills the popup, and a pick cancelled with Escape closes both', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const field = await fieldWith(page, 'Egy gépelt')
  await clickAt(field, 'szöveg:', { after: true })
  await page.keyboard.type(' [')
  await page.locator('.ref-popup button', { hasText: 'Pick in sidebar' }).click()
  await expandSidebar(s.sidebar)
  const row = s.sidebar.locator('.tree-row', { hasText: 'Osztó' })
  await row.hover()
  await row.locator('.select-as-target-btn').click()
  await waitFor(async () => (await page.locator('.ref-popup-target-label').count()) > 0)
  assert.match(await page.locator('.ref-popup-target').first().innerText(), /1\.3\.\s+Definíció/)
  await page.keyboard.press('Escape')
  await clickAt(field, 'szöveg:', { after: true })
  await page.keyboard.type(' [')
  await page.locator('.ref-popup button', { hasText: 'Pick in sidebar' }).click()
  await page.keyboard.press('Escape'); await pause(page)
  assert.equal(await popup(page).count(), 0)
  assert.equal(await s.sidebar.locator('.select-as-target-btn').count(), 0, 'the pick ended too')
})

test('the popup opens in every field that reads references, and in none of a formula\'s content, a claim formula or typewriter rows', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  for (const text of ['Egy ábra', 'Egy idézet', 'A második tulajdonság']) {
    const field = await fieldWith(page, text)
    await clickAt(field, text, { after: true })
    await page.keyboard.type('[')
    assert.equal(await popup(page).count(), 1, text)
    await page.keyboard.press('Escape'); await pause(page)
  }
  for (const text of ['a^2 + b^2']) {
    const field = await fieldWith(page, text)
    await clickAt(field, text, { after: true })
    await page.keyboard.type('[')
    assert.equal(await popup(page).count(), 0, text)
  }
  await page.locator('input').evaluateAll((els) => els.find((el) => el.value === 'első sor').focus())
  await page.keyboard.press('End')
  await page.keyboard.type('[')
  assert.equal(await popup(page).count(), 0, 'a typewriter row')
  const definition = await s.open('Prím')
  const formula = await fieldWith(definition, 'p_1 p_2')
  await clickAt(formula, '+ 1', { after: true })
  await definition.keyboard.type('[')
  assert.equal(await popup(definition).count(), 0, 'a claim formula')
})

test('clicking a reference opens the edit popup below it, highlighted; a template change shows live and Escape restores it', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const token = page.locator('.cm-yp-ref', { hasText: 'az [1.2. Tétel]' }).first()
  await token.click(); await pause(page, 200)
  assert.equal(await page.locator('.cm-yp-ref-active').count(), 1)
  const [tb, pb] = [await page.locator('.cm-yp-ref-active').boundingBox(), await popup(page).boundingBox()]
  assert.ok(pb.y >= tb.y + tb.height - 1, 'below it')
  await page.keyboard.press('ArrowUp'); await pause(page, 150)
  const live = await page.locator('.cm-yp-ref-active').innerText()
  assert.notEqual(live, 'az [1.2. Tétel]')
  await page.keyboard.press('Escape'); await pause(page)
  assert.equal(await page.locator('.cm-yp-ref-active').count(), 0)
  assert.equal((await tokenTexts(page))[3], 'az [1.2. Tétel]')
  await page.locator('.cm-yp-ref', { hasText: '[osztó]' }).first().click(); await pause(page, 200)
  await page.locator('.cm-yp-ref', { hasText: 'az [1.1. Definíció]' }).first().click(); await pause(page, 200)
  assert.equal(await popup(page).count(), 1, 'clicking another reference moves the popup there')
  assert.equal(await page.locator('.cm-yp-ref-active').innerText(), 'az [1.1. Definíció]')
})

test('a chapter list: add a chapter, remove one, check the preview and the saved targets', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Listák')
  await page.locator('.cm-yp-ref', { hasText: 'az [1.] és [3. fejezet]ekben' }).click(); await pause(page, 200)
  await page.getByText('+ Add target').click()
  await page.keyboard.type('2.'); await pause(page)
  await page.keyboard.press('Enter'); await pause(page, 200)
  assert.equal(await page.locator('.cm-yp-ref-active').innerText(), 'az [1.], [2.] és [3. fejezet]ekben')
  await page.locator('.ref-popup-row--static', { hasText: '3.' }).locator('button[title="Remove this target"]').click(); await pause(page, 200)
  assert.equal(await page.locator('.cm-yp-ref-active').innerText(), 'az [1.] és [2. fejezet]ekben')
  await page.locator('.ref-popup button', { hasText: 'Apply' }).click(); await pause(page)
  await save(page)
  assert.match(s.read(LISTAK), /targets: \[books\.konyv\.chapters\.egy, books\.konyv\.chapters\.ketto\]/)
})

test('a second chapter on a one-target template says why and blocks Apply until a list template is chosen', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Listák')
  await page.locator('.cm-yp-ref', { hasText: 'az [1. fejezet]' }).click(); await pause(page, 200)
  await page.getByText('+ Add target').click()
  await page.keyboard.type('2.'); await pause(page)
  await page.keyboard.press('Enter'); await pause(page, 200)
  assert.match(await popup(page).innerText(), /template 'the-index-chapter' takes exactly 1 target, not 2/)
  assert.ok(await page.locator('.ref-popup button', { hasText: 'Apply' }).isDisabled())
  assert.ok(await page.locator('.ref-popup-mode', { hasText: 'Text' }).isDisabled(), 'Text needs exactly one target')
  await page.locator('.ref-popup-row', { hasText: 'the-indexes-chapter-pl-ine' }).click(); await pause(page, 200)
  assert.ok(!(await page.locator('.ref-popup button', { hasText: 'Apply' }).isDisabled()))
})

test('a mixed list shows its targets in groups, and Text mode edits a one-target item', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Listák')
  await page.locator('.cm-yp-ref', { hasText: 'Definíció' }).first().click(); await pause(page, 200)
  assert.equal(await page.locator('.ref-popup-group').count(), 2, await popup(page).innerText())
  await page.keyboard.press('Escape')
  await page.locator('.cm-yp-ref', { hasText: 'az [1. fejezet]' }).click(); await pause(page, 200)
  await page.locator('.ref-popup-mode', { hasText: 'Text' }).click()
  await page.locator('.ref-popup-section .ref-popup-input').fill('[az első] fejezet')
  await page.keyboard.press('Enter'); await pause(page)
  assert.ok((await tokenTexts(page)).includes('[az első] fejezet'))
})

test('a renamed target shows "not found" with Re-pick, and a damaged reference offers only Remove', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Listák')
  await page.locator('.cm-yp-ref', { hasText: 'régi' }).click(); await pause(page, 200)
  assert.match(await popup(page).innerText(), /not found/)
  assert.equal(await page.locator('.ref-popup button', { hasText: 'Re-pick' }).count(), 1)
  await page.keyboard.press('Escape')
  const field = await fieldWith(page, 'Erről')
  await clickAt(field, 'Erről', { after: true })
  await page.keyboard.insertText(' [@zz]')
  await page.locator('.cm-yp-ref-error', { hasText: 'reference' }).click(); await pause(page, 200)
  assert.match(await popup(page).innerText(), /damaged/)
  assert.deepEqual(await popup(page).locator('button').allInnerTexts(), ['Remove'])
})

test('the popup refreshes its previews when the templates file changes, and shows the registry message when the registry is broken', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  await page.locator('.cm-yp-ref', { hasText: 'az [1.2. Tétel]' }).first().click(); await pause(page, 200)
  const file = 'display-templates/display-templates.hu.yaml'
  s.write(file, s.read(file).replace("template: '{the(target.index)} [{target.index} {capital(target.label.canonical)}]'", "template: '{the(target.index)} [{target.index} TÉTEL]'"))
  await waitFor(async () => (await popup(page).innerText()).includes('TÉTEL'))
  await page.keyboard.press('Escape')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(s.servicesFile('entity-labels.json'), '{ broken')
  await s.request('reloadModel', {})
  const again = await s.open('Prímek')
  await again.locator('.cm-yp-ref').first().click(); await pause(again, 300)
  assert.match(await popup(again).innerText(), /registry/)
})

test('Open on a target keeps the current panel, opened by a single click, beside the target\'s preview, and a URL opens in the browser', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const primek = await s.idOf('Prímek')
  assert.deepEqual(s.fake.tabs().map((tab) => [tab.nodeId, tab.preview]), [[primek, true]], 'a single click opens a preview')
  await page.locator('.cm-yp-ref', { hasText: 'az [1.2. Tétel]' }).first().click(); await pause(page, 200)
  await page.locator('.ref-popup button[title="Open"]').click()
  await s.fake.idle()
  await waitFor(() => s.fake.tabs().length === 2)
  const theorem = await s.idOf('A számelmélet alaptétele')
  assert.deepEqual(s.fake.tabs().map((tab) => [tab.nodeId, tab.preview]), [[primek, false], [theorem, true]])
  await page.keyboard.press('Escape')
  await page.locator('.block', { hasText: 'Embed' }).first().locator('button', { hasText: 'Open' }).click()
  await s.fake.idle()
  await waitFor(() => s.fake.tabs().some((tab) => tab.nodeId === s.fake.tabs().at(-1).nodeId && tab.nodeId !== theorem))
  assert.equal(s.fake.tabs().filter((tab) => tab.preview).length, 1, 'the embed\'s target replaced the earlier preview, not the panel')
  assert.ok(s.fake.tabs().some((tab) => tab.nodeId === primek && !tab.preview))
  await page.locator('.cm-yp-ref', { hasText: 'Wikipédia' }).click(); await pause(page, 200)
  await page.locator('.ref-popup button[title="Open"]').click(); await pause(page)
  assert.deepEqual(s.fake.external, ['parsed://https://hu.wikipedia.org/wiki/Pr%C3%ADmsz%C3%A1m'.replace('parsed://', '')])
})

test('near the bottom the popup opens above its reference, scrolls inside a short pane, and closes when the reference scrolls away', async (t) => {
  process.env.YOUPROOF_UI_HEIGHT = '420'
  t.after(() => { delete process.env.YOUPROOF_UI_HEIGHT })
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const token = page.locator('.cm-yp-ref', { hasText: 'az [1.3. Definíció]' })
  await token.evaluate((el) => el.scrollIntoView({ block: 'end' }))
  await token.click(); await pause(page, 300)
  const [tb, pb] = [await page.locator('.cm-yp-ref-active').boundingBox(), await popup(page).boundingBox()]
  assert.ok(pb.y + pb.height <= tb.y + 1, `above it (token ${tb.y}, popup ends ${pb.y + pb.height})`)
  await page.mouse.wheel(0, 40); await pause(page, 200)
  const [tb2, pb2] = [await page.locator('.cm-yp-ref-active').boundingBox(), await popup(page).boundingBox()]
  assert.ok(Math.abs((tb.y - pb.y) - (tb2.y - pb2.y)) < 2, 'it follows the reference')
  await page.mouse.wheel(0, -2000); await pause(page, 300)
  assert.equal(await popup(page).count(), 0, 'scrolled out of view, it closes')
})
