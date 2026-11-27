// References in the text fields of a panel: how they show and how they edit.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { closeBrowser, openSession } from './session.mjs'
import { clickAt, fieldWith, pause, save, tokenTexts } from './helpers.mjs'

const PRIMEK = 'books/konyv/01-resz/01-egy/01-primek.yaml'
after(closeBrowser)
const fresh = async (t) => { const session = await openSession(); t.after(() => session.close()); return session }

test('each reference shows as the site renders it, its links in brackets and not underlined', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  assert.deepEqual(await tokenTexts(page), [
    '[prím]', '[prím]', 'Az [1.2. Tétel]ben', 'az [1.2. Tétel]', '[osztó]', 'az [1.1. Definíció]', '[prímszám]',
    '[Wikipédia]', 'az [1.3. Definíció]', '[osztó]',
  ])
  const decorations = await page.$$eval('.cm-yp-ref-link', (els) => [...new Set(els.map((el) => getComputedStyle(el).textDecorationLine))])
  assert.deepEqual(decorations, ['none'])
})

test('a link\'s target shows in a tooltip within 150 ms, below the link, and goes when the pointer leaves', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const link = page.locator('.cm-yp-ref-link', { hasText: '1.2. Tétel' }).first()
  assert.equal(await link.getAttribute('title'), null, 'no native title, which the browser shows late')
  await page.evaluate(() => {
    window.tipTimes = {}
    document.addEventListener('mouseover', (event) => { if (event.target.closest('[data-tip]')) window.tipTimes.over ??= performance.now() })
    new MutationObserver(() => { if (!document.querySelector('.yp-tip').hidden) window.tipTimes.shown ??= performance.now() })
      .observe(document.querySelector('.yp-tip'), { attributes: true })
  })
  await link.hover()
  await page.waitForSelector('.yp-tip:not([hidden])')
  const { over, shown } = await page.evaluate(() => window.tipTimes)
  assert.ok(shown - over >= 100 && shown - over < 150, `shown ${shown - over} ms after the pointer arrived`)
  assert.equal(await page.locator('.yp-tip').innerText(), 'theorems.alaptetel')
  const [l, tip] = [await link.boundingBox(), await page.locator('.yp-tip').boundingBox()]
  assert.ok(tip.y >= l.y + l.height, 'below the link')
  await page.mouse.move(1, 1)
  assert.ok(await page.locator('.yp-tip').isHidden())
})

test('a reference is capitalized at a sentence start, and at the start of a bold run only when the run starts a sentence', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const field = await fieldWith(page, 'csak eggyel')
  assert.deepEqual(await tokenTexts(field), ['[prím]', '[prím]', 'Az [1.2. Tétel]ben', 'az [1.2. Tétel]'],
    'mid-sentence ***...*** keeps it lower case; **...** after a full stop capitalizes it')
  await clickAt(field, 'Egy ')
  await page.keyboard.press('Delete'); await page.keyboard.press('Delete'); await page.keyboard.press('Delete'); await page.keyboard.press('Delete')
  assert.equal((await tokenTexts(field))[0], '[Prím]', 'now it starts the field')
  await page.keyboard.type('Egy ')
  assert.equal((await tokenTexts(field))[0], '[prím]', 'and the capital follows it out again')
})

test('Backspace after a reference and Delete before one remove it whole, and undo and redo take it back and away', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const field = await fieldWith(page, 'Ekkor')
  await clickAt(field, ' szerint', {})
  await page.keyboard.press('Backspace')
  assert.equal(await field.innerText(), 'Ekkor  szerint:')
  await page.keyboard.press('Meta+z'); await pause(page)
  assert.equal(await field.innerText(), 'Ekkor [osztó] szerint:')
  await page.keyboard.press('Meta+Shift+z'); await pause(page)
  assert.equal(await field.innerText(), 'Ekkor  szerint:')
  await page.keyboard.press('Meta+z'); await pause(page)
  await clickAt(field, 'Ekkor', { after: true })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Delete')
  assert.equal(await field.innerText(), 'Ekkor  szerint:')
  await page.keyboard.press('Meta+z'); await pause(page)
  assert.equal(await field.innerText(), 'Ekkor [osztó] szerint:')
})

test('the caret steps over a reference with the arrow keys, and a selection takes a reference whole', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek')
  const field = await fieldWith(page, 'Ekkor')
  await clickAt(field, 'Ekkor', { after: true })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('X')
  assert.equal(await field.innerText(), 'Ekkor [osztó]X szerint:', 'one step over the reference')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('Y')
  assert.equal(await field.innerText(), 'Ekkor Y[osztó] szerint:', 'and back over it')
  await page.keyboard.press('Backspace')
  const start = await field.evaluate((root) => { const r = root.getBoundingClientRect(); return { x: r.left + 9, y: r.top + r.height / 2 } })
  const drag = async (fraction) => {
    const box = await field.locator('.cm-yp-ref').boundingBox()
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.type('Z')
    const text = await field.innerText()
    await page.keyboard.press('Meta+z'); await pause(page)
    return text
  }
  assert.equal(await drag(0.7), 'Z szerint:', 'a drag that ends in the right part of the reference takes it whole')
  assert.equal(await drag(0.3), 'Z[osztó] szerint:', 'one that ends in its left part stops before it, and never cuts it')
  await page.keyboard.press('Meta+z'); await pause(page)
})

test('a reference copied and pasted, in the panel and into another panel, is a reference of its own, and both files save', async (t) => {
  const s = await fresh(t)
  const page = await s.open('Prímek', { permanent: true })
  const field = await fieldWith(page, 'Ekkor')
  await clickAt(field, 'Ekkor', { after: true })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Meta+c')
  await clickAt(field, ' szerint', { after: true })
  await page.keyboard.press('Meta+v'); await pause(page)
  assert.deepEqual(await tokenTexts(field), ['[osztó]', '[osztó]'])
  const other = await s.open('Tételek', { permanent: true })
  const target = await fieldWith(other, 'Ebben a szakaszban')
  await clickAt(target, 'következik', { after: true })
  await other.keyboard.type(' ')
  await other.keyboard.press('Meta+v'); await pause(other, 300)
  assert.deepEqual(await tokenTexts(target), ['az [1.2. Tétel]', '[osztó]', 'az [1.3. Definíció]ban'], 'it renders in the other panel')
  await save(other)
  assert.match(s.read('books/konyv/01-resz/01-egy/02-tetelek.yaml'), /\{ text: '\[osztó\]', target: definitions\.oszto \}/)
  await save(page)
  assert.equal((s.read(PRIMEK).match(/text: '\[osztó\]', target: definitions\.oszto/g) ?? []).length, 3)
  assert.deepEqual(s.errors, [])
})
