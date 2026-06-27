import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { EditorState, Annotation, Prec } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, DecorationSet, ViewUpdate, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Range } from '@codemirror/state';
import { maskFormulas } from '../shared/formula';
import { useBracketEditingContext } from './contexts/BracketEditingContext';
import { useRefTermEditingContext } from './contexts/RefTermEditingContext';
import SuggestionPopup, { AnchorRect } from './SuggestionPopup';
import { useSuggestionPopup } from './hooks/useSuggestionPopup';
import RefSuggestionRow from './RefSuggestionRow';
import type { BracketInfo, RenameEvent } from './contexts/BracketEditingContext';
import type { RefSuggestion } from '../shared/types';

interface Props {
  value: string;
  onChange?: (v: string) => void;
  multiline?: boolean;
  bracketAutocomplete?: boolean;
  onSpecialKey?: (key: 'Enter' | 'Backspace' | 'Delete') => boolean;
  allowSelfReference?: boolean;
}

function findSingleBracketCtx(doc: string, pos: number): { start: number; end: number; name: string } | null {
  let i = pos - 1;
  while (i >= 0 && doc[i] !== '[' && doc[i] !== ']' && doc[i] !== '\n') i--;
  if (i < 0 || doc[i] !== '[') return null;
  if (i > 0 && doc[i - 1] === '[') return null;
  let j = pos;
  while (j < doc.length && doc[j] !== ']' && doc[j] !== '[' && doc[j] !== '\n') j++;
  if (j >= doc.length || doc[j] !== ']') return null;
  if (j + 1 < doc.length && doc[j + 1] === ']') return null;
  const name = doc.slice(i + 1, j);
  if (name === '*') return null;
  return { start: i + 1, end: j, name };
}

const ExternalUpdate    = Annotation.define<boolean>();
const BracketAutoEdit   = Annotation.define<boolean>();

// Order matters: [[...]] before [...] so double brackets are matched first.
// Groups: 1 = term, 2 = self-ref [*], 3 = ref, 4 = formula.
const SYNTAX_RE = /\[\[([a-zA-Z0-9\-]+)\]\]|\[(\*)\]|\[([a-zA-Z0-9\-]+)\]|\$([^$\n]+)\$/g;

function buildDecos(view: EditorView, supportsTerms: boolean): DecorationSet {
  const deco: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    SYNTAX_RE.lastIndex = 0;
    const text = view.state.sliceDoc(from, to);
    let m: RegExpExecArray | null;
    while ((m = SYNTAX_RE.exec(text)) !== null) {
      const s = from + m.index;
      const e = s + m[0].length;
      let cls: string;
      if (m[1] !== undefined) {
        if (!supportsTerms) continue;
        cls = 'cm-yp-term';
      } else if (m[2] !== undefined) {
        cls = 'cm-yp-ref';
      } else if (m[3] !== undefined) {
        cls = 'cm-yp-ref';
      } else {
        cls = 'cm-yp-formula';
      }
      deco.push(Decoration.mark({ class: cls }).range(s, e));
    }
  }
  return Decoration.set(deco, true);
}

function makeSyntaxPlugin(supportsTerms: boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildDecos(view, supportsTerms); }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = buildDecos(update.view, supportsTerms);
      }
    },
    { decorations: v => v.decorations },
  );
}

const vsCodeTheme = EditorView.theme({
  '&': {
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-foreground)',
    borderRadius: '3px',
    border: '1px solid var(--vscode-input-border, transparent)',
  },
  '&.cm-focused': { outline: '1px solid var(--vscode-focusBorder)', outlineOffset: '-1px' },
  '.cm-content': {
    fontFamily: 'var(--vscode-editor-font-family)',
    fontSize: 'var(--vscode-editor-font-size)',
    padding: '4px 8px',
    caretColor: 'var(--vscode-editorCursor-foreground, var(--vscode-foreground))',
  },
  '.cm-cursorLayer': { animationName: 'none' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--vscode-editorCursor-foreground, var(--vscode-foreground))',
    borderLeftWidth: '2px',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'var(--vscode-editor-selectionBackground)',
  },
  '.cm-selectionBackground': { background: 'var(--vscode-editor-inactiveSelectionBackground)' },
  '.cm-gutters': { display: 'none' },
  '.cm-yp-formula': { color: '#dcdcaa' },
  '.cm-yp-term':    { color: '#c8a832' },
  '.cm-yp-ref':     { color: '#9b72d0' },
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isInsideFormula(doc: string, pos: number): boolean {
  let count = 0;
  for (let i = 0; i < pos; i++) { if (doc[i] === '$') count++; }
  return count % 2 === 1;
}

function isInsideEmptyBracket(doc: string, pos: number): boolean {
  if (pos <= 0 || pos >= doc.length) return false;
  return doc[pos - 1] === '[' && doc[pos] === ']';
}

function isInsideEmptySingleBracket(doc: string, pos: number): boolean {
  if (!isInsideEmptyBracket(doc, pos)) return false;
  if (pos >= 2 && doc[pos - 2] === '[') return false;
  if (pos + 1 < doc.length && doc[pos + 1] === ']') return false;
  return true;
}

function bracketInfoAt(state: EditorState, pos: number): BracketInfo | null {
  const doc = state.doc.toString();

  // Scan backward for opening bracket
  let i = pos - 1;
  while (i >= 0 && doc[i] !== '[' && doc[i] !== ']' && doc[i] !== '\n') i--;
  if (i < 0 || doc[i] !== '[') return null;

  const isDouble = i > 0 && doc[i - 1] === '[';
  const nameStart = i + 1;

  // Scan forward for closing bracket
  let j = pos;
  while (j < doc.length && doc[j] !== ']' && doc[j] !== '[' && doc[j] !== '\n') j++;
  if (j >= doc.length || doc[j] !== ']') return null;

  if (isDouble) {
    if (j + 1 >= doc.length || doc[j + 1] !== ']') return null;
  }

  const name = doc.slice(nameStart, j);
  if (name.length === 0) return null;

  return { type: isDouble ? 'term' : 'ref', name };
}

interface BracketSpan {
  openStart: number;
  contentStart: number;
  contentEnd: number;
  closeEnd: number;
}

function findBracketSpanForChar(doc: string, charPos: number): BracketSpan | null {
  const ch = doc[charPos];
  if (ch !== '[' && ch !== ']') return null;

  if (ch === '[') {
    const openStart = (charPos > 0 && doc[charPos - 1] === '[') ? charPos - 1 : charPos;
    const isDouble   = openStart + 1 < doc.length && doc[openStart + 1] === '[';
    const contentStart = openStart + (isDouble ? 2 : 1);
    let j = contentStart;
    while (j < doc.length && doc[j] !== ']' && doc[j] !== '[' && doc[j] !== '\n') j++;
    if (j >= doc.length || doc[j] !== ']') return null;
    if (isDouble) {
      if (j + 1 >= doc.length || doc[j + 1] !== ']') return null;
      return { openStart, contentStart, contentEnd: j, closeEnd: j + 2 };
    }
    return { openStart, contentStart, contentEnd: j, closeEnd: j + 1 };
  }

  // ch === ']'
  let firstClose: number;
  let isDouble: boolean;
  if (charPos + 1 < doc.length && doc[charPos + 1] === ']') {
    firstClose = charPos; isDouble = true;
  } else if (charPos > 0 && doc[charPos - 1] === ']') {
    firstClose = charPos - 1; isDouble = true;
  } else {
    firstClose = charPos; isDouble = false;
  }
  const contentEnd = firstClose;
  const closeEnd   = firstClose + (isDouble ? 2 : 1);
  let i = contentEnd - 1;
  while (i >= 0 && doc[i] !== '[' && doc[i] !== ']' && doc[i] !== '\n') i--;
  if (i < 0 || doc[i] !== '[') return null;
  if (isDouble) {
    if (i === 0 || doc[i - 1] !== '[') return null;
    return { openStart: i - 1, contentStart: i + 1, contentEnd, closeEnd };
  }
  return { openStart: i, contentStart: i + 1, contentEnd, closeEnd };
}

function applyRenameToView(view: EditorView, event: RenameEvent): void {
  // Scan masked text so occurrences inside $...$ formulas are skipped; masking
  // preserves offsets, so the change ranges still map onto the real document.
  const text = maskFormulas(view.state.doc.toString());
  const escaped = escapeRegex(event.oldName);
  const re = event.type === 'ref'
    ? new RegExp(`(?<!\\[)\\[${escaped}\\](?!\\])`, 'g')
    : new RegExp(`\\[\\[${escaped}\\]\\]`, 'g');

  const changes: { from: number; to: number; insert: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const nameStart = event.type === 'ref' ? m.index + 1 : m.index + 2;
    const nameEnd   = nameStart + event.oldName.length;
    changes.push({ from: nameStart, to: nameEnd, insert: event.newName });
  }
  if (changes.length === 0) return;
  view.dispatch({ changes, annotations: ExternalUpdate.of(true) });
}

export interface CodeMirrorFieldHandle {
  focus: () => void;
  focusAt: (target: 'start' | 'end' | number) => void;
  getContent: () => string;
  getCursor: () => { pos: number; isAtStart: boolean; isAtEnd: boolean };
}

const CodeMirrorField = forwardRef<CodeMirrorFieldHandle, Props>(function CodeMirrorField(
  { value, onChange, multiline = false, bracketAutocomplete = false, onSpecialKey, allowSelfReference = false }, ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef      = useRef<EditorView | null>(null);
  const onChangeRef  = useRef(onChange);
  onChangeRef.current = onChange;
  const onSpecialKeyRef = useRef(onSpecialKey);
  onSpecialKeyRef.current = onSpecialKey;
  const allowSelfRefRef = useRef(allowSelfReference);
  allowSelfRefRef.current = allowSelfReference;
  const ctx = useBracketEditingContext();
  const refTermCtx = useRefTermEditingContext();
  const fetchRefSuggestions = ctx.fetchRefSuggestions;
  const fetchRefSuggestionsRef = useRef(fetchRefSuggestions);
  fetchRefSuggestionsRef.current = fetchRefSuggestions;

  // ─── Ref-suggestion popup (only active when fetchRefSuggestions is provided) ──
  const [refBracketCtx, setRefBracketCtx] =
    useState<{ start: number; end: number; name: string; anchorRect: AnchorRect } | null>(null);
  // Type-to-open gate: the popup is shown only after the user actually types
  // into the bracket. Cursor movement / focus alone won't reopen it; Escape
  // toggles it back off until the next character typed.
  const [popupOpenedByTyping, setPopupOpenedByTyping] = useState(false);

  const commitRefSuggestion = useCallback((r: RefSuggestion) => {
    const view = viewRef.current;
    if (!view || !refBracketCtx) return;
    refTermCtx.ensureRefFromSuggestion(r);
    view.dispatch({
      changes:   { from: refBracketCtx.start, to: refBracketCtx.end, insert: r.name },
      selection: { anchor: refBracketCtx.start + r.name.length + 1 },
      annotations: BracketAutoEdit.of(true),
    });
    view.focus();
    setRefBracketCtx(null);
  }, [refBracketCtx, refTermCtx]);

  const refPopupFetcher = (fetchRefSuggestions && refBracketCtx)
    ? () => fetchRefSuggestions(refBracketCtx.name)
    : null;

  const refPopup = useSuggestionPopup<RefSuggestion>({
    typed:        refBracketCtx?.name ?? '',
    fetchItems:   refPopupFetcher,
    getKey:       (r) => r.name,
    getMatchText: (r) => r.display,
    onCommit:     commitRefSuggestion,
    filterAndSort: false,
  });

  // Mirror the bracket state into the popup hook (open/close + re-fetch on name change).
  // Gated by popupOpenedByTyping so the popup never appears from cursor-only movement.
  useEffect(() => {
    if (refBracketCtx && fetchRefSuggestionsRef.current && popupOpenedByTyping) refPopup.open();
    else refPopup.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refBracketCtx?.start, refBracketCtx?.end, refBracketCtx?.name, popupOpenedByTyping]);

  const refPopupRef = useRef(refPopup);
  refPopupRef.current = refPopup;

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    focusAt: (target) => {
      const view = viewRef.current; if (!view) return;
      view.focus();
      const len = view.state.doc.length;
      const pos = target === 'start' ? 0 : target === 'end' ? len : Math.max(0, Math.min(len, target));
      view.dispatch({ selection: { anchor: pos } });
    },
    getContent: () => viewRef.current?.state.doc.toString() ?? '',
    getCursor: () => {
      const view = viewRef.current;
      if (!view) return { pos: 0, isAtStart: true, isAtEnd: true };
      const pos = view.state.selection.main.head;
      const len = view.state.doc.length;
      return { pos, isAtStart: pos === 0, isAtEnd: pos === len };
    },
  }), []);

  useEffect(() => {
    let prevInfo: BracketInfo | null = null;
    const syntaxPlugin = makeSyntaxPlugin(ctx.supportsTerms ?? false);

    const bracketInputHandler = EditorView.inputHandler.of((view, from, to, insert) => {
      if (insert !== '[' && insert !== ']') return false;
      if (!bracketAutocomplete) return false;
      if (insert === '[') {
        if (from !== to) return false;
        const doc = view.state.doc.toString();
        if (isInsideFormula(doc, from)) return false;
        const charBefore   = from > 0 ? doc[from - 1] : '';
        const charAfter    = from < doc.length ? doc[from] : '';
        const insideSingle = charBefore === '[' && charAfter === ']';
        const insideDouble = insideSingle && from >= 2 && doc[from - 2] === '[';
        if (insideSingle) {
          if (!insideDouble && ctx.supportsTerms) {
            view.dispatch({
              changes: [
                { from, to: from, insert: '[' },
                { from: from + 1, to: from + 1, insert: ']' },
              ],
              selection: { anchor: from + 1 },
              annotations: BracketAutoEdit.of(true),
            });
          }
          // [ is not a valid name character — block without inserting
          return true;
        }
        view.dispatch({
          changes: { from, to, insert: '[]' },
          selection: { anchor: from + 1 },
          annotations: BracketAutoEdit.of(true),
        });
        return true;
      }
      if (insert === ']') {
        if (from !== to) return false;
        const doc = view.state.doc.toString();
        if (isInsideFormula(doc, from)) return false;
        const c0 = from < doc.length     ? doc[from]     : '';
        const c1 = from + 1 < doc.length ? doc[from + 1] : '';
        if (c0 === ']' && c1 === ']') {
          view.dispatch({ selection: { anchor: from + 2 } });
          return true;
        }
        if (c0 === ']') {
          view.dispatch({ selection: { anchor: from + 1 } });
          return true;
        }
        return false;
      }
      return false;
    });

    const handleBracketDelete = (view: EditorView, charPos: number): boolean => {
      if (!bracketAutocomplete) return false;
      const doc = view.state.doc.toString();
      if (charPos < 0 || charPos >= doc.length) return false;
      if (doc[charPos] !== '[' && doc[charPos] !== ']') return false;
      if (isInsideFormula(doc, charPos)) return false;
      const span = findBracketSpanForChar(doc, charPos);
      if (!span) return false;
      if (span.contentStart === span.contentEnd) {
        view.dispatch({
          changes: { from: span.openStart, to: span.closeEnd, insert: '' },
          selection: { anchor: span.openStart },
        });
      } else {
        const target = charPos < span.contentStart ? span.contentStart : span.contentEnd;
        view.dispatch({ selection: { anchor: target } });
      }
      return true;
    };

    const bracketDeleteKeymap = keymap.of([
      {
        key: 'Backspace',
        run: (view) => {
          const pos = view.state.selection.main.head;
          if (view.state.selection.main.from !== view.state.selection.main.to) return false;
          return handleBracketDelete(view, pos - 1);
        },
      },
      {
        key: 'Delete',
        run: (view) => {
          const pos = view.state.selection.main.head;
          if (view.state.selection.main.from !== view.state.selection.main.to) return false;
          return handleBracketDelete(view, pos);
        },
      },
    ]);

    const transactionFilter = EditorState.transactionFilter.of(tr => {
      if (!tr.docChanged) return tr;
      if (tr.annotation(ExternalUpdate)) return tr;
      if (tr.annotation(BracketAutoEdit)) return tr;
      const pos  = tr.startState.selection.main.head;
      const info = bracketInfoAt(tr.startState, pos);
      const startDoc = tr.startState.doc.toString();
      const inEmptySingle = !info && isInsideEmptySingleBracket(startDoc, pos);
      const inEmpty       = !info && isInsideEmptyBracket(startDoc, pos);
      if (!info && !inEmpty) return tr;
      // Inside a bracket — restrict insertions; deletions always pass.
      let ok = true;
      tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
        const s = inserted.toString();
        if (s.length === 0) return;
        if (info) {
          if (info.name === '*') { ok = false; return; }                         // [*] complete — locked
          if (!/^[a-zA-Z0-9\-]+$/.test(s)) ok = false;
          return;
        }
        // empty bracket (single or double)
        if (inEmptySingle && allowSelfRefRef.current && s === '*') return;       // OK — produces [*]
        if (!/^[a-zA-Z0-9\-]+$/.test(s)) ok = false;
      });
      return ok ? tr : [];
    });

    const specialKeymap = Prec.highest(keymap.of([
      { key: 'Enter',     run: () => onSpecialKeyRef.current?.('Enter')     ?? false },
      { key: 'Backspace', run: () => onSpecialKeyRef.current?.('Backspace') ?? false },
      { key: 'Delete',    run: () => onSpecialKeyRef.current?.('Delete')    ?? false },
    ]));

    // Highest-precedence keymap so the suggestion popup wins over default
    // ArrowUp/Down/Enter/Escape when it's open and a row is selected.
    const refPopupKeymap = Prec.highest(keymap.of([
      { key: 'ArrowDown', run: () => refPopupRef.current.navigateDown() },
      { key: 'ArrowUp',   run: () => refPopupRef.current.navigateUp() },
      { key: 'Escape',    run: () => {
        if (refPopupRef.current.active) { setPopupOpenedByTyping(false); return true; }
        return false;
      } },
      { key: 'Enter',     run: () => refPopupRef.current.commitSelected() },
    ]));

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          refPopupKeymap,
          specialKeymap,
          bracketInputHandler,
          bracketDeleteKeymap,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          vsCodeTheme,
          ...(bracketAutocomplete ? [syntaxPlugin] : []),
          EditorView.lineWrapping,
          transactionFilter,
          ...(multiline ? [] : [
            EditorState.transactionFilter.of(tr => tr.newDoc.lines > 1 ? [] : tr),
          ]),
          EditorView.updateListener.of(update => {
            if (!bracketAutocomplete) {
              if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
              return;
            }

            const filterTerms = (info: BracketInfo | null) =>
              info?.type === 'term' && !ctx.supportsTerms ? null : info;
            const filterSelfRef = (info: BracketInfo | null) =>
              info?.name === '*' ? null : info;

            const isExternal = update.transactions.some(t => t.annotation(ExternalUpdate));
            if (isExternal) {
              prevInfo = filterSelfRef(filterTerms(bracketInfoAt(update.state, update.state.selection.main.head)));
              if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
              return;
            }

            if (update.focusChanged && update.view.hasFocus) {
              ctx.onFieldFocused((info) => {
                const pos  = view.state.selection.main.head;
                const text = info.type === 'ref' ? `[${info.name}]` : `[[${info.name}]]`;
                view.dispatch({
                  changes:   { from: pos, to: pos, insert: text },
                  selection: { anchor: pos + text.length },
                });
                view.focus();
              });
            }

            if (update.focusChanged && !update.view.hasFocus) {
              ctx.setActiveItem(null);
              prevInfo = null;
              return;
            }

            if (!update.docChanged && !update.selectionSet && !update.focusChanged) return;

            const cursor  = update.state.selection.main.head;
            const doc     = update.state.doc.toString();
            const newInfo = isInsideFormula(doc, cursor)
              ? null
              : filterSelfRef(filterTerms(bracketInfoAt(update.state, cursor)));

            const oldPrevInfo = prevInfo;

            if (update.docChanged && newInfo) {
              if (!prevInfo) {
                ctx.onBracketContentChange(null, newInfo);
              } else if (prevInfo.type === newInfo.type && prevInfo.name !== newInfo.name) {
                ctx.onBracketContentChange(prevInfo, newInfo);
              }
            }

            if (newInfo?.type !== prevInfo?.type || newInfo?.name !== prevInfo?.name) {
              ctx.setActiveItem(newInfo ?? null);
            }

            prevInfo = newInfo;
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
            if (update.docChanged && oldPrevInfo && !newInfo) {
              ctx.onBracketEmpty(oldPrevInfo);
            }

            // Update ref-suggestion bracket context if a fetcher is provided.
            // popupOpenedByTyping is set true on any doc change while the cursor sits
            // inside a single bracket; cleared whenever the cursor leaves or the field blurs.
            if (fetchRefSuggestionsRef.current && update.view.hasFocus) {
              const docStr  = update.state.doc.toString();
              const cursor2 = update.state.selection.main.head;
              const found   = isInsideFormula(docStr, cursor2)
                ? null
                : findSingleBracketCtx(docStr, cursor2);
              if (found) {
                const c = update.view.coordsAtPos(found.start);
                if (c) {
                  const anchorRect: AnchorRect = { top: c.top, bottom: c.bottom, left: c.left, right: c.right };
                  setRefBracketCtx(prev =>
                    prev && prev.start === found.start && prev.end === found.end && prev.name === found.name
                      ? prev
                      : { ...found, anchorRect }
                  );
                }
                if (update.docChanged) setPopupOpenedByTyping(true);
              } else {
                setRefBracketCtx(null);
                setPopupOpenedByTyping(false);
              }
            } else if (!update.view.hasFocus) {
              setRefBracketCtx(null);
              setPopupOpenedByTyping(false);
            }
          }),
        ],
      }),
      parent: containerRef.current!,
    });
    viewRef.current = view;

    const unsubscribe = bracketAutocomplete
      ? refTermCtx.subscribeToRename(event => {
          if (viewRef.current) applyRenameToView(viewRef.current, event);
        })
      : undefined;

    return () => {
      unsubscribe?.();
      view.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return (
    <>
      <div ref={containerRef} className="cm-field" />
      {refPopup.active && refPopup.displayed.length > 0 && refBracketCtx && (
        <SuggestionPopup<RefSuggestion>
          items={refPopup.displayed}
          selectedIdx={refPopup.selectedIdx}
          getKey={(r) => r.name}
          renderItem={(r) => <RefSuggestionRow item={r} typed={refBracketCtx.name} />}
          renderContainer={(children) => <div className="ref-display-suggestions__table">{children}</div>}
          anchorRect={refBracketCtx.anchorRect}
          preferred="below"
          onPick={(r) => commitRefSuggestion(r)}
          selectedItemRef={refPopup.selectedItemRef}
        />
      )}
    </>
  );
});

export default CodeMirrorField;
