import { EditorSelection, EditorState, StateField, Transaction, type ChangeSpec, type Extension, type SelectionRange } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { findReferenceTokens, referenceTokenLabel, type ReferenceTokenMatch } from '../shared/referenceToken';

class ReferenceWidget extends WidgetType {
  constructor(readonly label: string) { super(); }
  eq(other: ReferenceWidget): boolean { return other.label === this.label; }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-yp-ref';
    span.textContent = `[${this.label}]`;
    return span;
  }
}

function tokenDecorations(state: EditorState): DecorationSet {
  return Decoration.set(findReferenceTokens(state.doc.toString()).map((token) =>
    Decoration.replace({ widget: new ReferenceWidget(referenceTokenLabel(token.item)) }).range(token.from, token.to)));
}

const referenceTokenField = StateField.define<DecorationSet>({
  create: tokenDecorations,
  update: (decorations, tr) => (tr.docChanged ? tokenDecorations(tr.state) : decorations),
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

const strictlyInside = (pos: number, token: ReferenceTokenMatch): boolean => token.from < pos && pos < token.to;

/** Whether `pos` is a character of a reference token. */
export function isInReferenceToken(doc: string, pos: number): boolean {
  return findReferenceTokens(doc).some((token) => token.from <= pos && pos < token.to);
}

function clampRange(range: SelectionRange, tokens: readonly ReferenceTokenMatch[], previousHead: number): SelectionRange {
  const token = (pos: number) => tokens.find((t) => strictlyInside(pos, t));
  if (range.empty) {
    const inside = token(range.head);
    if (!inside) return range;
    return EditorSelection.cursor(previousHead <= inside.from ? inside.to : inside.from);
  }
  const fromToken = token(range.from);
  const toToken = token(range.to);
  if (!fromToken && !toToken) return range;
  const from = fromToken ? fromToken.from : range.from;
  const to = toToken ? toToken.to : range.to;
  return range.anchor <= range.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
}

/**
 * A reference token is never cut: a change that starts or ends inside one is
 * widened to take the whole token, text inserted inside one goes after it, and a
 * selection that would start or end inside one is moved to its edges.
 */
const keepTokensWhole = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged) {
    const tokens = findReferenceTokens(tr.startState.doc.toString());
    if (tokens.length === 0) return tr;
    const changes: ChangeSpec[] = [];
    let widened = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const insertion = fromA === toA;
      const from = tokens.find((t) => strictlyInside(fromA, t))?.[insertion ? 'to' : 'from'] ?? fromA;
      const to = tokens.find((t) => strictlyInside(toA, t))?.to ?? toA;
      if (from !== fromA || to !== toA) widened = true;
      changes.push({ from, to, insert: inserted });
    });
    if (!widened) return tr;
    const changeSet = tr.startState.changes(changes);
    return {
      changes: changeSet,
      selection: tr.startState.selection.map(changeSet, 1),
      scrollIntoView: tr.scrollIntoView,
      userEvent: tr.annotation(Transaction.userEvent),
      annotations: Transaction.addToHistory.of(tr.annotation(Transaction.addToHistory) ?? true),
    };
  }
  if (!tr.selection) return tr;
  const tokens = findReferenceTokens(tr.newDoc.toString());
  const previous = tr.startState.selection.main.head;
  const clamped = EditorSelection.create(tr.selection.ranges.map((range) => clampRange(range, tokens, previous)), tr.selection.mainIndex);
  if (clamped.eq(tr.selection)) return tr;
  return { selection: clamped, scrollIntoView: tr.scrollIntoView, userEvent: tr.annotation(Transaction.userEvent) };
});

/**
 * Show each reference token the text holds as one atomic unit, so the caret steps
 * over it and Backspace or Delete removes it whole. Until references render inline,
 * it shows as its literal text or its template's name.
 */
export function referenceTokens(): Extension {
  return [referenceTokenField, keepTokensWhole];
}
