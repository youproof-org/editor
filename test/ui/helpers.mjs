// What the UI tests do to a panel, the way a user does it: by pointer and keyboard.

/** The text fields of a panel, in page order. */
export const fields = (page) => page.locator('.node-view .cm-content')

/** The first text field whose visible text contains `text`. */
export async function fieldWith(page, text) {
  const index = await fields(page).evaluateAll((els, t) => els.findIndex((el) => el.innerText.includes(t)), text)
  if (index === -1) throw new Error(`no field shows ${JSON.stringify(text)}`)
  return fields(page).nth(index)
}

/** The reference widgets, not the `[*]` of a figure. */
export const TOKENS = '.cm-yp-ref:is(.cm-yp-ref-rendered, .cm-yp-ref-error, .cm-yp-ref-pending):not(.cm-yp-ref-self)'

/** The rendered references of a field or page, as their visible text. */
export const tokenTexts = (scope) => scope.locator(TOKENS).allInnerTexts()

/**
 * Put the caret before (or `after`) the first occurrence of `text` in the plain
 * text of `field`, by clicking there.
 */
export async function clickAt(field, text, { after = false } = {}) {
  const point = await field.evaluate((root, { text, after }) => {
    root.scrollIntoView({ block: 'center' })
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement.closest('.cm-yp-ref') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(text)
      if (at === -1) continue
      const range = document.createRange()
      const char = after ? at + text.length - 1 : at
      range.setStart(node, char)
      range.setEnd(node, char + 1)
      const box = range.getBoundingClientRect()
      return { x: after ? box.right - 0.5 : box.left + 0.5, y: box.top + box.height / 2 }
    }
    return null
  }, { text, after })
  if (!point) throw new Error(`no plain text ${JSON.stringify(text)} in the field`)
  await field.page().mouse.click(point.x, point.y)
}

/** The caret's offset in the field's visible text, a widget counting as its text. */
export const caretText = (field) => field.evaluate((root) => {
  const selection = root.ownerDocument.getSelection()
  const range = document.createRange()
  range.setStart(root, 0)
  range.setEnd(selection.focusNode, selection.focusOffset)
  return range.toString()
})

export const pause = (page, ms = 80) => page.waitForTimeout(ms)

/** Make the panel dirty without changing it, then save it with Cmd+S. */
export async function touchAndSave(page, field) {
  await field.click()
  if (await page.locator('.ref-popup').count() > 0) await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('x')
  await page.keyboard.press('Backspace')
  await save(page)
}

export async function save(page) {
  await page.keyboard.press('Meta+s')
  await page.waitForFunction(() => !document.querySelector('.entity-dirty'), null, { timeout: 5000 })
  await page.waitForTimeout(100)
}
