import {
  EditorSelection, EditorState, StateEffect, StateField, Transaction, type ChangeSpec, type Extension, type SelectionRange,
} from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { capitalizeSegments } from '@youproof.org/display-templates';
import { decodeReferencePayload, findReferenceTokens, referenceTokenLabel, type ReferenceTokenMatch } from '../shared/referenceToken';
import {
  referencePlacements, selfReferencePlacements, type ReferencePlacement, type SelfReferencePlacement,
} from '../shared/referencePlacement';
import type { ReferenceTokenDisplay } from '../shared/types';
import type { ReferenceDisplaySource } from './referenceDisplays';
import { referencePopupField, referenceTokenClick, type ReferencePopupSession } from './referencePopupState';

/** What a token shows: its rendered display, or its name while it renders or when it can't. */
export interface ReferenceTokenView {
  state: 'rendered' | 'pending' | 'error';
  /** The words, each link marked with its target. */
  parts: { text: string; target?: string }[];
  /** Why the token is in its error state. */
  reason?: string;
}

const named = (state: ReferenceTokenView['state'], item: unknown, reason?: string): ReferenceTokenView =>
  ({ state, parts: [{ text: referenceTokenLabel(item) }], ...(reason ? { reason } : {}) });

/**
 * What a token shows where it sits: the display the host rendered, capitalized
 * where the site starts a sentence with it, or an error where the site wouldn't
 * render it.
 */
export function referenceTokenView(
  token: Pick<ReferenceTokenMatch, 'item'>,
  placement: ReferencePlacement,
  display: ReferenceTokenDisplay | undefined,
  readsReferences = true,
): ReferenceTokenView {
  if (token.item === undefined) return named('error', token.item, 'This reference is damaged and can\'t be read.');
  if (!readsReferences) {
    return named('error', token.item, 'The site reads no references in this field, so it can\'t be saved here. Move it to the text.');
  }
  if (!placement.read) {
    return named('error', token.item, 'The site doesn\'t read a reference inside $...$ or ^...^, so it can\'t be saved here. Move it out.');
  }
  if (!display) return named('pending', token.item);
  if (display.error !== undefined) return named('error', token.item, display.error);
  const segments = placement.sentenceStart ? capitalizeSegments(display.segments) : display.segments;
  return {
    state: 'rendered',
    parts: segments.filter((segment) => segment.text !== '' || segment.kind === 'link')
      .map((segment) => (segment.kind === 'link' ? { text: segment.text, target: segment.target } : { text: segment.text })),
  };
}

/**
 * What a field's `[*]` shows: the figure's self-reference as the host rendered
 * it, `pending` while it renders, or `none` in a field where the site shows `[*]`
 * as an error, any field but a figure's lead-in.
 */
export type SelfReferenceDisplay = ReferenceTokenDisplay | 'pending' | 'none';

const selfNamed = (state: ReferenceTokenView['state'], reason?: string): ReferenceTokenView =>
  ({ state, parts: [{ text: '*' }], ...(reason ? { reason } : {}) });

/** What a `[*]` shows where it sits, capitalized where the site starts a sentence with it. */
export function selfReferenceTokenView(display: SelfReferenceDisplay, placement: Pick<SelfReferencePlacement, 'sentenceStart'>): ReferenceTokenView {
  if (display === 'none') return selfNamed('error', 'The site reads [*] only in a figure\'s lead-in, and shows it as an error here.');
  if (display === 'pending') return selfNamed('pending');
  if (display.error !== undefined) return selfNamed('error', display.error);
  const segments = placement.sentenceStart ? capitalizeSegments(display.segments) : display.segments;
  return {
    state: 'rendered',
    parts: segments.filter((segment) => segment.text !== '' || segment.kind === 'link')
      .map((segment) => (segment.kind === 'link' ? { text: segment.text, target: segment.target } : { text: segment.text })),
  };
}

/** The view as plain text, each link in brackets. */
export function referenceTokenText(view: ReferenceTokenView): string {
  return view.parts.map((part) => (part.target === undefined ? part.text : `[${part.text}]`)).join('');
}

/** How a token stands out: `active` while its popup is open, `ghost` for the draft of a popup that creates one, `self` for a `[*]`, which has no popup. */
type WidgetRole = 'token' | 'active' | 'ghost' | 'self';

class ReferenceWidget extends WidgetType {
  private readonly key: string;
  constructor(readonly view: ReferenceTokenView, readonly role: WidgetRole = 'token') {
    super();
    this.key = JSON.stringify([view, role]);
  }
  eq(other: ReferenceWidget): boolean { return other.key === this.key; }
  toDOM(editor: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = `cm-yp-ref cm-yp-ref-${this.view.state}${this.role === 'token' ? '' : ` cm-yp-ref-${this.role}`}`;
    if (this.view.reason) span.dataset.tip = this.view.reason;
    if (this.role === 'token' || this.role === 'active') {
      span.addEventListener('mousedown', (event) => {
        const open = editor.state.facet(referenceTokenClick);
        if (!open || event.button !== 0) return;
        const from = editor.posAtDOM(span);
        const token = findReferenceTokens(editor.state.doc.toString()).find((t) => t.from === from);
        if (!token) return;
        event.preventDefault();
        open(editor, token.from, token.to);
      });
    }
    if (this.view.state !== 'rendered') {
      span.textContent = `[${this.view.parts.map((part) => part.text).join('')}]`;
      return span;
    }
    for (const part of this.view.parts) {
      if (part.target === undefined) {
        span.append(part.text);
      } else {
        const link = document.createElement('span');
        link.className = 'cm-yp-ref-link';
        if (part.target) link.dataset.tip = part.target;
        link.textContent = `[${part.text}]`;
        span.append(link);
      }
    }
    return span;
  }
}

export interface ReferenceTokenOptions {
  /** Where the rendered displays come from. Without one, each token shows its name. */
  displays?: ReferenceDisplaySource | null;
  /** Whether the site reads references from this field. */
  readsReferences?: boolean;
  /** What the field's `[*]` shows at first; `setSelfReferenceDisplay` changes it. */
  selfReference?: SelfReferenceDisplay;
}

const displaysChanged = StateEffect.define<null>();

/** The field's `[*]` now shows this. */
export const setSelfReferenceDisplay = StateEffect.define<SelfReferenceDisplay>();

function selfReferenceField(initial: SelfReferenceDisplay) {
  return StateField.define<SelfReferenceDisplay>({
    create: () => initial,
    update: (value, tr) => tr.effects.reduce((v, effect) => (effect.is(setSelfReferenceDisplay) ? effect.value : v), value),
  });
}

function decodedItem(payload: string): unknown {
  try {
    return decodeReferencePayload(payload);
  } catch {
    return undefined;
  }
}

function tokenDecorations(
  state: EditorState, options: ReferenceTokenOptions, selfField: StateField<SelfReferenceDisplay>,
): DecorationSet {
  const text = state.doc.toString();
  const session = state.field(referencePopupField, false) ?? null;
  const view = (payload: string, item: unknown, placement: ReferencePlacement): ReferenceTokenView => {
    const display = item === undefined ? undefined : options.displays?.get(payload);
    return referenceTokenView({ item }, placement, display, options.readsReferences);
  };
  const placements = referencePlacements(text);
  const decorations = findReferenceTokens(text).map((token, i) => {
    const active = session?.mode === 'edit' && session.from === token.from;
    const payload = active && session.preview ? session.preview : token.payload;
    const item = payload === token.payload ? token.item : decodedItem(payload);
    return Decoration.replace({ widget: new ReferenceWidget(view(payload, item, placements[i]), active ? 'active' : 'token') })
      .range(token.from, token.to);
  });
  const self = options.readsReferences === false ? [] : selfReferencePlacements(text).map((placement) =>
    Decoration.replace({ widget: new ReferenceWidget(selfReferenceTokenView(state.field(selfField), placement), 'self') })
      .range(placement.from, placement.to));
  const ghost = session?.mode === 'create' && session.preview ? ghostDecoration(text, session, view) : null;
  return Decoration.set([...decorations, ...self, ...(ghost ? [ghost] : [])], true);
}

/** The draft of a create popup where it would go, shown as the token it would be. */
function ghostDecoration(
  text: string, session: ReferencePopupSession, view: (payload: string, item: unknown, placement: ReferencePlacement) => ReferenceTokenView,
) {
  const payload = session.preview!;
  const before = text.slice(0, session.from);
  const placement = referencePlacements(`${before}[@${payload}]${text.slice(session.to)}`)[findReferenceTokens(before).length];
  const widget = new ReferenceWidget(view(payload, decodedItem(payload), placement), 'ghost');
  return session.from === session.to
    ? Decoration.widget({ widget, side: 1 }).range(session.from)
    : Decoration.replace({ widget }).range(session.from, session.to);
}

function referenceTokenField(options: ReferenceTokenOptions, selfField: StateField<SelfReferenceDisplay>) {
  return StateField.define<DecorationSet>({
    create: (state) => tokenDecorations(state, options, selfField),
    update: (decorations, tr) => (tr.docChanged || tr.effects.some((effect) => effect.is(displaysChanged) || effect.is(setSelfReferenceDisplay)) ||
      tr.startState.field(referencePopupField, false) !== tr.state.field(referencePopupField, false)
      ? tokenDecorations(tr.state, options, selfField)
      : decorations),
    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ],
  });
}

function rerenderOnDisplayChange(source: ReferenceDisplaySource): Extension {
  return ViewPlugin.define((view) => {
    const unsubscribe = source.subscribe(() => view.dispatch({ effects: displaysChanged.of(null) }));
    return { destroy: unsubscribe };
  });
}

type Span = { from: number; to: number };

const strictlyInside = (pos: number, token: Span): boolean => token.from < pos && pos < token.to;

/** The reference tokens of `doc`, and the `[*]` the site reads where it reads references, which are never cut. */
function wholeSpans(doc: string, readsReferences = true): Span[] {
  return readsReferences ? [...findReferenceTokens(doc), ...selfReferencePlacements(doc)] : findReferenceTokens(doc);
}

/** Whether `pos` is a character of a reference token or of a `[*]`. */
export function isInReferenceToken(doc: string, pos: number): boolean {
  return wholeSpans(doc).some((token) => token.from <= pos && pos < token.to);
}

function clampRange(range: SelectionRange, tokens: readonly Span[], previousHead: number): SelectionRange {
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
 * A reference token or a `[*]` is never cut: a change that starts or ends inside
 * one is widened to take the whole token, text inserted inside one goes after it,
 * and a selection that would start or end inside one is moved to its edges.
 */
const keepTokensWhole = (readsReferences: boolean | undefined) => EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged) {
    const tokens = wholeSpans(tr.startState.doc.toString(), readsReferences);
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
  const tokens = wholeSpans(tr.newDoc.toString(), readsReferences);
  const previous = tr.startState.selection.main.head;
  const clamped = EditorSelection.create(tr.selection.ranges.map((range) => clampRange(range, tokens, previous)), tr.selection.mainIndex);
  if (clamped.eq(tr.selection)) return tr;
  return { selection: clamped, scrollIntoView: tr.scrollIntoView, userEvent: tr.annotation(Transaction.userEvent) };
});

/**
 * Show each reference token the text holds as one atomic unit, so the caret steps
 * over it and Backspace or Delete removes it whole. It shows the reference as the
 * site renders it, with each link in brackets, rendered again when the displays
 * change and wherever the token moves, since the start of a sentence capitalizes it.
 * A `[*]` shows the same way, as the figure's self-reference.
 */
export function referenceTokens(options: ReferenceTokenOptions = {}): Extension {
  const selfField = selfReferenceField(options.selfReference ?? 'none');
  return [
    referencePopupField,
    selfField,
    referenceTokenField(options, selfField),
    keepTokensWhole(options.readsReferences),
    ...(options.displays ? [rerenderOnDisplayChange(options.displays)] : []),
  ];
}
