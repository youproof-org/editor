// Writes every reference of the content as the site build resolves it and as its
// pages render it, for test/site-references.test.mjs to compare the editor
// against. It runs inside a services checkout, with the website's own graph
// builder and InlineText:
//
//   cd <services>/apps/website
//   CONTENT_DIR=<content>/content node --import tsx --import ./test/support/register.mjs \
//     <editor>/test/support/dump-site-references.mts <out.json>
//
// `references` holds each owner's resolved list in list order. `inline` holds what
// InlineText renders for each reference of the owner's text fields, in the order
// the page renders them, sentence-start capitalization included. Each reference
// is rendered between two markers, which InlineText treats as whitespace, and the
// HTML between them is read back as text, each link in brackets.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const { buildContentGraph } = await import(path.resolve('lib/content/graph.ts'))
const { default: InlineText } = await import(path.resolve('components/content/InlineText.tsx'))
const websiteRequire = createRequire(path.resolve('package.json'))
const React = websiteRequire('react')
const { renderToStaticMarkup } = websiteRequire('react-dom/server')
const graph = await buildContentGraph()

type Target = { type: string; fqn?: string; url?: string }
type Segment = { kind: string; text: string; target?: Target }
type Ref = { segments: Segment[] }
type Block = Record<string, unknown> & { type: string }

const key = (target: Target) => (target.type === 'external' ? target.url : target.fqn)
const rendered = (node: { references: Ref[] }) =>
  node.references.map(({ segments }) => ({
    marked: segments.map((s) => (s.kind === 'link' ? `[${s.text}]` : s.text)).join(''),
    links: segments.filter((s) => s.kind === 'link').map((s) => key(s.target!)),
  }))

const OPEN = '\uFEFF'
const CLOSE = (index: number) => `\u2029${index}\u2028`
const REGION = /\uFEFF([\s\S]*?)\u2029(\d+)\u2028|<span class="ref-error">\[(\d+)\]<\/span>/g

function decode(html: string): string {
  return html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')
}

function readRegion(html: string): { marked: string; links: string[] } {
  const links: string[] = []
  const marked = html
    .replace(/<span class="inline-math"><span class="tex-src">([\s\S]*?)<\/span><\/span>/g, (_, source) => `$${source}$`)
    .replace(/<a ([^>]*)>/g, (_, attrs: string) => {
      links.push(decode((attrs.match(/data-target-fqn="([^"]*)"/) ?? attrs.match(/href="([^"]*)"/))![1]))
      return '['
    })
    .replace(/<\/a>/g, ']')
    .replace(/<strong><em>|<\/em><\/strong>/g, '***')
    .replace(/<\/?strong>/g, '**')
  if (/<[a-z/]/i.test(marked)) throw new Error(`unexpected markup in a rendered reference: ${marked}`)
  return { marked: decode(marked), links }
}

function texts(blocks: unknown): string[] {
  const out: string[] = []
  if (!Array.isArray(blocks)) return out
  const add = (...fields: unknown[]) => {
    for (const field of fields) if (typeof field === 'string') out.push(field)
  }
  for (const block of blocks as Block[]) {
    switch (block.type) {
      case 'narrative': add((block.content as string).trim()); break
      case 'claim': add(block.content); break
      case 'formula': add(block.leadIn, block.leadOut); break
      case 'figure': add(block.leadIn, block.caption); break
      case 'unordered-list':
      case 'ordered-list': add(block.leadIn, ...(block.items as string[])); break
      case 'typewriter': add(block.leadIn); break
      case 'quote': add(block.leadIn, block.quote); break
      case 'details': add(block.title); out.push(...texts(block.blocks)); break
      case 'subsection': out.push(...texts(block.blocks)); break
    }
  }
  return out
}

function inline(node: { references: Ref[] }, fields: unknown[]) {
  const refs = node.references.map((ref, index) => (ref.segments.length === 0
    ? ref
    : { ...ref, segments: [{ kind: 'text', text: OPEN }, ...ref.segments, { kind: 'text', text: CLOSE(index) }] }))
  const out: unknown[] = []
  for (const text of fields.flatMap(texts)) {
    const html: string = renderToStaticMarkup(React.createElement(InlineText, { text, refs }))
    for (const match of html.matchAll(REGION)) {
      if (match[3] !== undefined) {
        out.push({ index: Number(match[3]), error: 'renders nothing' })
        continue
      }
      const before = html.slice(0, match.index)
      const display = readRegion(match[1])
      out.push(before.endsWith('<span class="ref-error">[')
        ? { index: Number(match[2]), error: `renders as an error: ${display.marked}` }
        : { index: Number(match[2]), ...display })
    }
  }
  return out
}

const references: Record<string, unknown> = {}
const inlined: Record<string, unknown> = {}
const add = (owner: string, node: { references: Ref[] }, fields: unknown[]) => {
  references[owner] = rendered(node)
  inlined[owner] = inline(node, fields)
}
for (const [fqn, chapter] of graph.chapters) {
  add(`chapter:${fqn}`, chapter, [chapter.abstract, chapter.prerequisiteWarning, chapter.prologue, chapter.epilogue])
  for (const section of chapter.sections) add(`section:${fqn}.sections.${section.name}`, section, [section.body])
}
for (const [kind, map] of [['definition', graph.definitions], ['theorem', graph.theorems], ['proof', graph.proofs], ['remark', graph.remarks]] as const) {
  for (const [fqn, node] of map) add(`${kind}:${fqn}`, node, [node.body])
}
writeFileSync(process.argv[2], JSON.stringify({ references, inline: inlined }))
console.log(`${Object.keys(references).length} reference owners written to ${process.argv[2]}`)
