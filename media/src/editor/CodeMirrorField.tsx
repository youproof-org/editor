import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { EditorState, Annotation, Prec } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, DecorationSet, ViewUpdate, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Range } from '@codemirror/state';
import { maskFormulas } from '../shared/formula';
import { isInReferenceToken, referenceTokens } from './referenceTokens';
import { useReferenceDisplays } from './referenceDisplays';
import {
  openReferencePopup, closeReferencePopup, ReferencePopupEdit, referencePopupField, referenceTokenAtCaret, referenceTokenClick,
  referenceTriggerAt, selectedReferenceToken,
} from './referencePopupState';
import { useReferencePopupHost } from './contexts/ReferencePopupContext';
import { useBracketEditingContext } from './contexts/BracketEditingContext';
import { useTermEditingContext } from './contexts/TermEditingContext';
import type { BracketInfo, RenameEvent } from './contexts/BracketEditingContext';

interface Props {
  value: string;
  onChange?: (v: string) => void;
  multiline?: boolean;
  bracketAutocomplete?: boolean;
  onSpecialKey?: (key: 'Enter' | 'Backspace' | 'Delete') => boolean;
  allowSelfReference?: boolean;
  /** Whether the site reads references from the field: `[` opens the reference popup only where it does, and a token elsewhere shows as an error. */
  readsReferences: boolean;
}

const ExternalUpdate    = Annotation.define<boolean>();
const BracketAutoEdit   = Annotation.define<boolean>();

// Order matters: [[...]] before [...] so double brackets are matched first.
// Groups: 1 = term, 2 = self-ref [*], 3 = reference index [i], 4 = formula.
const SYNTAX_RE = /\[\[([a-zA-Z0-9\-]+)\]\]|\[(\*)\]|\[(\d+)\]|\$([^$\n]+)\$/g;

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
  '.cm-yp-ref-link': { textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.cm-yp-ref-pending': { opacity: '0.6' },
  '.cm-yp-ref-error': {
    color: 'var(--vscode-errorForeground, #f48771)',
    textDecoration: 'wavy underline',
    textDecorationColor: 'var(--vscode-editorError-foreground, #f14c4c)',
  },
  '.cm-yp-ref-active': {
    background: 'var(--vscode-editor-findMatchHighlightBackground, rgba(155, 114, 208, 0.25))',
    outline: '1px solid var(--vscode-editor-findMatchBorder, #9b72d0)',
    borderRadius: '2px',
  },
  '.cm-yp-ref-ghost': {
    opacity: '0.75',
    outline: '1px dashed #9b72d0',
    borderRadius: '2px',
  },
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isInsideFormula(doc: string, pos: number): boolean {
  let count = 0;
  for (let i = 0; i < pos; i++) { if (doc[i] === '$') count++; }
  return count % 2 === 1;
}

function isInsideEmptyTermMarker(doc: string, pos: number): boolean {
  return pos >= 2 && doc.slice(pos - 2, pos + 2) === '[[]]';
}

interface BracketAt { type: 'term'; name: string; }

function bracketInfoAt(state: EditorState, pos: number): BracketAt | null {
  const doc = state.doc.toString();

  // Scan backward for opening bracket
  let i = pos - 1;
  while (i >= 0 && doc[i] !== '[' && doc[i] !== ']' && doc[i] !== '\n') i--;
  if (i < 0 || doc[i] !== '[') return null;

  if (i === 0 || doc[i - 1] !== '[') return null;
  const nameStart = i + 1;

  // Scan forward for closing bracket
  let j = pos;
  while (j < doc.length && doc[j] !== ']' && doc[j] !== '[' && doc[j] !== '\n') j++;
  if (j + 1 >= doc.length || doc[j] !== ']' || doc[j + 1] !== ']') return null;

  const name = doc.slice(nameStart, j);
  if (name.length === 0) return null;

  return { type: 'term', name };
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
  const re = new RegExp(`\\[\\[${escapeRegex(event.oldName)}\\]\\]`, 'g');

  const changes: { from: number; to: number; insert: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const nameStart = m.index + 2;
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
  { value, onChange, multiline = false, bracketAutocomplete = false, onSpecialKey, allowSelfReference = false, readsReferences }, ref,
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
  const termCtx = useTermEditingContext();
  const referenceDisplays = useReferenceDisplays();
  const popupHost = useReferencePopupHost();
  const popupHostRef = useRef(popupHost);
  popupHostRef.current = popupHost;

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

    const openPopup = (view: EditorView, mode: 'create' | 'edit', from: number, to: number, query = ''): boolean => {
      const host = popupHostRef.current;
      if (!host) return false;
      view.dispatch({ effects: openReferencePopup.of({ mode, from, to }) });
      const canHoldTermMarker = mode === 'create' && from === to && bracketAutocomplete && (ctx.supportsTerms ?? false);
      host.open({
        view, mode, from, to, query, allowSelfReference: allowSelfRefRef.current,
        ...(canHoldTermMarker ? {
          insertTermMarker: () => {
            const session = view.state.field(referencePopupField, false);
            if (!session) return;
            view.dispatch({
              changes: { from: session.from, to: session.to, insert: '[[]]' },
              selection: { anchor: session.from + 2 },
              effects: closeReferencePopup.of(null),
              annotations: BracketAutoEdit.of(true),
            });
            view.focus();
          },
        } : {}),
      });
      return true;
    };

    const triggerAt = (view: EditorView, from: number, to: number): boolean => {
      if (!popupHostRef.current) return false;
      const trigger = referenceTriggerAt(
        view.state.doc.toString(), { from, to, head: view.state.selection.main.head }, readsReferences,
      );
      return trigger ? openPopup(view, 'create', trigger.from, trigger.to, trigger.query) : false;
    };
    // Caught at keydown, before the browser types the bracket, so that the editor
    // doesn't redraw its selection, and take the focus back from the popup, after it opens.
    const referenceTrigger = [
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (event.key !== '[' || event.ctrlKey || event.metaKey || event.isComposing) return false;
          const { from, to } = view.state.selection.main;
          if (!triggerAt(view, from, to)) return false;
          event.preventDefault();
          return true;
        },
      }),
      EditorView.inputHandler.of((view, from, to, insert) => insert === '[' && triggerAt(view, from, to)),
    ];

    const referenceKeymap = Prec.highest(keymap.of([
      {
        key: 'F2',
        run: (view) => {
          const token = referenceTokenAtCaret(view.state);
          return token ? openPopup(view, 'edit', token.from, token.to) : false;
        },
      },
      {
        key: 'Enter',
        run: (view) => {
          const token = selectedReferenceToken(view.state);
          return token ? openPopup(view, 'edit', token.from, token.to) : false;
        },
      },
    ]));

    const bracketInputHandler = EditorView.inputHandler.of((view, from, to, insert) => {
      if (!bracketAutocomplete) return false;
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
      if (isInsideFormula(doc, charPos) || isInReferenceToken(doc, charPos)) return false;
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
      if (tr.annotation(ReferencePopupEdit)) return tr;
      const pos  = tr.startState.selection.main.head;
      const info = bracketInfoAt(tr.startState, pos);
      if (!info && !isInsideEmptyTermMarker(tr.startState.doc.toString(), pos)) return tr;
      // Inside a term marker — restrict insertions to name characters; deletions always pass.
      let ok = true;
      tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
        const s = inserted.toString();
        if (s.length > 0 && !/^[a-zA-Z0-9\-]+$/.test(s)) ok = false;
      });
      return ok ? tr : [];
    });

    const specialKeymap = Prec.highest(keymap.of([
      { key: 'Enter',     run: () => onSpecialKeyRef.current?.('Enter')     ?? false },
      { key: 'Backspace', run: () => onSpecialKeyRef.current?.('Backspace') ?? false },
      { key: 'Delete',    run: () => onSpecialKeyRef.current?.('Delete')    ?? false },
    ]));

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          referenceKeymap,
          specialKeymap,
          referenceTrigger,
          bracketInputHandler,
          bracketDeleteKeymap,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          vsCodeTheme,
          referenceTokens({ displays: referenceDisplays, readsReferences }),
          referenceTokenClick.of((view, from, to) => { openPopup(view, 'edit', from, to); }),
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

            const termAt = (info: BracketAt | null): BracketInfo | null =>
              info?.type === 'term' && ctx.supportsTerms ? { type: 'term', name: info.name } : null;

            const isExternal = update.transactions.some(t => t.annotation(ExternalUpdate));
            if (isExternal) {
              prevInfo = termAt(bracketInfoAt(update.state, update.state.selection.main.head));
              if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
              return;
            }

            if (update.focusChanged && update.view.hasFocus) {
              ctx.onFieldFocused((info) => {
                const pos  = view.state.selection.main.head;
                const text = `[[${info.name}]]`;
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
              : termAt(bracketInfoAt(update.state, cursor));

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
          }),
        ],
      }),
      parent: containerRef.current!,
    });
    viewRef.current = view;

    const unsubscribe = bracketAutocomplete
      ? termCtx.subscribeToRename(event => {
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

  return <div ref={containerRef} className="cm-field" />;
});

export default CodeMirrorField;
