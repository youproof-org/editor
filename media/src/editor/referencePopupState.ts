import {
  Annotation, EditorSelection, Facet, StateEffect, StateField, Transaction, type EditorState, type TransactionSpec,
} from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { encodeReferenceToken, findReferenceTokens } from '../shared/referenceToken';
import { referencePlacements } from '../shared/referencePlacement';

/** The part of a field a reference popup is about: the caret or selection it creates at, or the token it edits. */
export interface ReferencePopupRange {
  mode: 'create' | 'edit';
  from: number;
  to: number;
}

/** An open popup, as the field shows it: the range, and the payload of the reference it would write now. */
export interface ReferencePopupSession extends ReferencePopupRange {
  preview?: string;
}

export const openReferencePopup = StateEffect.define<ReferencePopupRange>();
/** The payload the popup would write now, which the token or the ghost at the caret shows; null for none yet. */
export const previewReference = StateEffect.define<string | null>();
export const closeReferencePopup = StateEffect.define<null>();

/** Marks a change the popup makes, so the field's typing rules let it through. */
export const ReferencePopupEdit = Annotation.define<boolean>();

const holdsOneToken = (state: EditorState, from: number, to: number): boolean => {
  const found = findReferenceTokens(state.sliceDoc(from, to));
  return found.length === 1 && found[0].from === 0 && found[0].to === to - from;
};

/**
 * The open popup of a field, which follows its range through changes made around
 * it, and ends when the token it edits is gone.
 */
export const referencePopupField = StateField.define<ReferencePopupSession | null>({
  create: () => null,
  update(session, tr) {
    if (session && tr.docChanged) {
      const from = tr.changes.mapPos(session.from, session.mode === 'edit' ? 1 : -1);
      const to = tr.changes.mapPos(session.to, session.mode === 'edit' ? -1 : 1);
      session = session.mode === 'edit' && (to <= from || !holdsOneToken(tr.state, from, to)) ? null : { ...session, from, to };
    }
    for (const effect of tr.effects) {
      if (effect.is(openReferencePopup)) session = { ...effect.value };
      else if (effect.is(closeReferencePopup)) session = null;
      else if (effect.is(previewReference) && session) {
        const { preview: _old, ...rest } = session;
        session = effect.value === null ? rest : { ...rest, preview: effect.value };
      }
    }
    return session;
  },
});

/** Who opens a popup when a token is clicked: the field that holds it. */
export const referenceTokenClick = Facet.define<(view: EditorView, from: number, to: number) => void, ((view: EditorView, from: number, to: number) => void) | null>({
  combine: (handlers) => handlers[0] ?? null,
});

function isInsideFormula(doc: string, pos: number): boolean {
  let count = 0;
  for (let i = 0; i < pos; i++) if (doc[i] === '$') count++;
  return count % 2 === 1;
}

function isInsideTermMarker(doc: string, pos: number): boolean {
  for (const match of doc.matchAll(/\[\[[^\]\n]*\]\]/g)) {
    if (match.index! < pos && pos < match.index! + match[0].length) return true;
  }
  return false;
}

const PROBE = '[@x]';

/** What `[` typed over the range would open: the create popup's range and its search query. */
export interface ReferenceTrigger {
  from: number;
  to: number;
  query: string;
}

/**
 * Whether `[` typed at the selection opens the create popup, and over what. It opens
 * in a field the site reads references from, where the site would read a token put
 * there: not inside `$...$` or `^...^`, nor after an unclosed `$`, nor inside a
 * `[[...]]` term marker. A selection on one line that holds no token is replaced by
 * the reference, the spaces around it aside, and is its search query; another
 * selection is left alone and the popup opens at the caret.
 */
export function referenceTriggerAt(
  doc: string, selection: { from: number; to: number; head: number }, readsReferences: boolean,
): ReferenceTrigger | null {
  if (!readsReferences) return null;
  const selected = doc.slice(selection.from, selection.to);
  const usesSelection = selected.trim() !== '' && !selected.includes('\n') && findReferenceTokens(selected).length === 0;
  const from = usesSelection ? selection.from + (selected.length - selected.trimStart().length) : selection.head;
  const to = usesSelection ? selection.to - (selected.length - selected.trimEnd().length) : selection.head;
  if (isInsideFormula(doc, from) || isInsideTermMarker(doc, from)) return null;
  const before = doc.slice(0, from);
  const placement = referencePlacements(before + PROBE + doc.slice(to))[findReferenceTokens(before).length];
  if (!placement?.read) return null;
  return { from, to, query: usesSelection ? selected.trim() : '' };
}

/**
 * What a `[` typed into the create popup's search box does: with nothing typed yet
 * it is the second `[` of a term marker, which closes the popup and puts `[[]]` in
 * the field where the field can hold one, and is ignored elsewhere. After a word it
 * is part of the search.
 */
export function secondBracketAction(query: string, canHoldTermMarker: boolean): 'term-marker' | 'ignore' | 'search' {
  if (query !== '') return 'search';
  return canHoldTermMarker ? 'term-marker' : 'ignore';
}

/** The token the caret touches, the one before it first, for opening it from the keyboard. */
export function referenceTokenAtCaret(state: EditorState): { from: number; to: number } | null {
  const { main } = state.selection;
  if (!main.empty) return null;
  const tokens = findReferenceTokens(state.doc.toString());
  const token = tokens.find((t) => t.to === main.head) ?? tokens.find((t) => t.from === main.head);
  return token ? { from: token.from, to: token.to } : null;
}

/** The token the selection is exactly, for opening it with Enter. */
export function selectedReferenceToken(state: EditorState): { from: number; to: number } | null {
  const { main } = state.selection;
  if (main.empty || !holdsOneToken(state, main.from, main.to)) return null;
  return { from: main.from, to: main.to };
}

function popupChange(state: EditorState, insert: string): TransactionSpec {
  const session = state.field(referencePopupField, false);
  if (!session) return {};
  return {
    changes: { from: session.from, to: session.to, insert },
    selection: EditorSelection.cursor(session.from + insert.length),
    effects: closeReferencePopup.of(null),
    annotations: [isolateHistory.of('full'), ReferencePopupEdit.of(true), Transaction.userEvent.of('input.reference')],
    scrollIntoView: true,
  };
}

/** Confirming the popup: the token for `item` in place of the range, as one step of the history, the caret after it. */
export function confirmReferenceSpec(state: EditorState, item: unknown): TransactionSpec {
  return popupChange(state, encodeReferenceToken(item));
}

/** Confirming the figure's self-reference: `[*]` in place of the range. */
export function confirmSelfReferenceSpec(state: EditorState): TransactionSpec {
  return popupChange(state, '[*]');
}

/** Removing the reference the edit popup belongs to, as one step of the history. */
export function removeReferenceSpec(state: EditorState): TransactionSpec {
  const session = state.field(referencePopupField, false);
  return session?.mode === 'edit' ? popupChange(state, '') : {};
}

/** Closing the popup with nothing changed: no change, so nothing in the history. */
export function cancelReferenceSpec(): TransactionSpec {
  return { effects: closeReferencePopup.of(null), annotations: Transaction.addToHistory.of(false) };
}
