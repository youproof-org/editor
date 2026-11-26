// Writes every reference of the content as the site build resolves it, for
// test/site-references.test.mjs to compare the editor's resolution against. It
// runs inside a services checkout, with the website's own graph builder:
//
//   cd <services>/apps/website
//   CONTENT_DIR=<content>/content node --import tsx --import ./test/support/register.mjs \
//     <editor>/test/support/dump-site-references.mts <out.json>
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const { buildContentGraph } = await import(path.resolve('lib/content/graph.ts'))
const graph = await buildContentGraph()

type Segment = { kind: string; text: string; target?: { type: string; fqn?: string; url?: string } }
const key = (target: NonNullable<Segment['target']>) => (target.type === 'external' ? target.url : target.fqn)
const rendered = (node: { references: { segments: Segment[] }[] }) =>
  node.references.map(({ segments }) => ({
    marked: segments.map((s) => (s.kind === 'link' ? `[${s.text}]` : s.text)).join(''),
    links: segments.filter((s) => s.kind === 'link').map((s) => key(s.target!)),
  }))

const owners: Record<string, unknown> = {}
for (const [fqn, chapter] of graph.chapters) {
  owners[`chapter:${fqn}`] = rendered(chapter)
  for (const section of chapter.sections) owners[`section:${fqn}.sections.${section.name}`] = rendered(section)
}
for (const [kind, map] of [['definition', graph.definitions], ['theorem', graph.theorems], ['proof', graph.proofs], ['remark', graph.remarks]] as const) {
  for (const [fqn, node] of map) owners[`${kind}:${fqn}`] = rendered(node)
}
writeFileSync(process.argv[2], JSON.stringify(owners))
console.log(`${Object.keys(owners).length} reference owners written to ${process.argv[2]}`)
