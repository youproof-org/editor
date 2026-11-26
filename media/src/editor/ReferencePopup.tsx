import { KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { capitalizeSegments } from '@youproof.org/display-templates';
import Badge from './Badge';
import { encodeReferenceToken, findReferenceTokens } from '../shared/referenceToken';
import type { ContentTargetObject, ReferenceChoices, ReferenceTargetChoice, ReferenceTokenSegment } from '../shared/types';
import type { ReferencePopupRequest } from './contexts/ReferencePopupContext';
import { useTargetSelectionContext } from './contexts/TargetSelectionContext';
import { useReferenceDisplays } from './referenceDisplays';
import {
  buildReferenceItem, candidateTemplates, canReorder, choicesByPath, draftFromItem, draftProblem, draftTarget, filterTemplates,
  kindsKey, leavesItemUnchanged, orderedTargets, searchReferenceTargets, targetGroups, textFromSegments, textModeProblem,
  type DraftTarget, type ReferenceDraft, type SearchHit,
} from './referencePopupModel';
import {
  cancelReferenceSpec, confirmReferenceSpec, confirmSelfReferenceSpec, previewReference, probePlacement, removeReferenceSpec,
  secondBracketAction,
} from './referencePopupState';
import { useReferencePopupPlacement } from './hooks/useReferencePopupPlacement';

export const REFERENCE_POPUP_SELECTOR = 'reference-popup';
const REFERENCE_TARGET_KINDS = ['chapter', 'section', 'definition', 'theorem', 'proof', 'remark', 'claim', 'term'];
const POPUP_WIDTH = 480;

interface Props {
  request: ReferencePopupRequest;
  choices: ReferenceChoices | null;
  choicesError: string | null;
  onClose: () => void;
}

const payloadOf = (item: unknown): string => encodeReferenceToken(item).slice(2, -1);

type Shown = { state: 'pending' } | { state: 'error'; reason: string } | { state: 'rendered'; segments: ReferenceTokenSegment[] };

function Rendered({ shown, fallback }: { shown: Shown; fallback?: string }) {
  if (shown.state === 'pending') return <span className="ref-popup-rendered ref-popup-rendered--pending">{fallback ?? '…'}</span>;
  if (shown.state === 'error') return <span className="ref-popup-rendered ref-popup-rendered--error" title={shown.reason}>{shown.reason}</span>;
  return (
    <span className="ref-popup-rendered">
      {shown.segments.map((segment, i) => (segment.kind === 'link'
        ? <span key={i} className="ref-popup-link" title={segment.target}>[{segment.text}]</span>
        : <span key={i}>{segment.text}</span>))}
    </span>
  );
}

function TargetLine({ target, choice }: { target: DraftTarget; choice: ReferenceTargetChoice | undefined }) {
  if (!choice) {
    return (
      <span className="ref-popup-target">
        <Badge type={target.kind === 'external' ? 'external' : 'section'} />
        <span className="ref-popup-target-label">{target.path}</span>
        {target.kind !== 'external' && <span className="ref-popup-dim">the editor doesn&apos;t load this, so it can&apos;t check it</span>}
      </span>
    );
  }
  return (
    <span className="ref-popup-target">
      <Badge type={choice.kind} />
      <span className="ref-popup-target-label">{choice.kind === 'claim' && choice.owner ? `${choice.owner} ${choice.label}` : choice.label}</span>
      {choice.title && <span className="ref-popup-dim">{choice.title}</span>}
      {choice.kind !== 'claim' && choice.owner && <span className="ref-popup-dim">· {choice.owner}</span>}
      {choice.problem && <span className="ref-popup-warning" title={choice.problem}>!</span>}
    </span>
  );
}

function HitRow({ hit, selected, onPick, rowRef }: { hit: SearchHit; selected: boolean; onPick: () => void; rowRef?: React.Ref<HTMLDivElement> }) {
  let body: ReactNode;
  if (hit.kind === 'self') body = <><span className="ref-popup-link">[*]</span><span className="ref-popup-dim">the figure itself</span></>;
  else if (hit.kind === 'url') body = <><Badge type="external" /><span className="ref-popup-target-label">{hit.url}</span><span className="ref-popup-dim">a link with text you write</span></>;
  else if (hit.kind === 'path') body = <><span className="ref-popup-target-label">{hit.path}</span><span className="ref-popup-dim">the editor doesn&apos;t load this {hit.targetKind}, so it can&apos;t check it</span></>;
  else if (hit.kind === 'term') {
    body = <>
      <Badge type="term" />
      <span className="ref-popup-target-label">{hit.text}</span>
      <span className="ref-popup-dim">{hit.target.label}{hit.target.owner ? ` · ${hit.target.owner}` : ''}</span>
      {hit.uses !== undefined && <span className="ref-popup-count">{hit.uses}</span>}
    </>;
  } else body = <TargetLine target={{ path: hit.target.path, kind: hit.target.kind }} choice={hit.target} />;
  return (
    <div ref={rowRef} className={`ref-popup-row${selected ? ' ref-popup-row--selected' : ''}`}
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}>
      {body}
    </div>
  );
}

const hitGroup = (hit: SearchHit): string => (hit.kind === 'term' ? 'Terms' : hit.kind === 'target' ? 'Numbered' : '');

export default function ReferencePopup({ request, choices, choicesError, onClose }: Props) {
  const { view } = request;
  const displays = useReferenceDisplays();
  const selection = useTargetSelectionContext();
  const popupRef = useRef<HTMLDivElement>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [query, setQuery] = useState(request.query);
  const [hitIndex, setHitIndex] = useState(0);
  const [draft, setDraft] = useState<ReferenceDraft | null>(null);
  const [filter, setFilter] = useState('');
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ replace?: string } | null>(null);
  const [damaged, setDamaged] = useState<string | null>(null);
  const pickingRef = useRef(false);
  pickingRef.current = picking;
  const editing = request.mode === 'edit';
  const [original] = useState(() => (editing ? findReferenceTokens(view.state.sliceDoc(request.from, request.to))[0] : undefined));

  const templates = choices?.templates ?? [];
  const byPath = useMemo(() => (choices ? choicesByPath(choices) : new Map<string, ReferenceTargetChoice>()), [choices]);
  const hits = useMemo(() => (choices ? searchReferenceTargets(choices, query, { allowSelfReference: request.allowSelfReference && !adding }) : []),
    [choices, query, request.allowSelfReference, adding]);
  const selectedText = request.from < request.to ? view.state.sliceDoc(request.from, request.to) : '';
  const [sentenceStart] = useState(() => probePlacement(view.state.doc.toString(), request.from, request.to)?.sentenceStart ?? false);

  const focusRef = useRef<HTMLInputElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const cancelPickRef = useRef<HTMLButtonElement>(null);
  const screen = damaged ? 'damaged' : picking ? 'picking' : !draft || adding ? 'search' : draft.mode;
  useLayoutEffect(() => { (focusRef.current ?? removeRef.current ?? cancelPickRef.current)?.focus(); }, [screen]);
  useEffect(() => displays?.subscribe(rerender), [displays]);
  useEffect(() => { setHitIndex(0); }, [query]);
  useEffect(() => {
    const row = selectedRowRef.current;
    const list = row?.closest('.ref-popup-list');
    if (!row || !list) return;
    const top = row.offsetTop - (list as HTMLElement).offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
  });

  const shownFor = (item: unknown): Shown => {
    const display = displays?.get(payloadOf(item));
    if (!display) return { state: 'pending' };
    if (display.error !== undefined) return { state: 'error', reason: display.error };
    return { state: 'rendered', segments: sentenceStart ? capitalizeSegments(display.segments) : display.segments };
  };

  const startedEdit = useRef(false);
  useEffect(() => {
    if (!editing || !choices || choices.error || startedEdit.current) return;
    startedEdit.current = true;
    const edited = original?.item !== undefined ? draftFromItem(original.item, byPath) : undefined;
    if (edited) setDraft(edited);
    else setDamaged(original?.item === undefined ? 'This reference is damaged and can\'t be read.' : 'This reference is not one the popup can edit.');
  }, [choices]);

  const finish = (spec: Parameters<typeof view.dispatch>[0]) => {
    if (pickingRef.current) selection.onEndSelectTarget(null);
    if (view.dom.isConnected) {
      view.dispatch(spec);
      view.focus();
    }
    onClose();
  };
  const cancel = () => finish(cancelReferenceSpec());
  const confirmItem = (item: unknown) => finish(confirmReferenceSpec(view.state, item));

  const problem = draft ? draftProblem(draft, templates) : undefined;
  const item = draft && !problem ? buildReferenceItem(draft, templates) : null;
  const itemPayload = item ? payloadOf(item) : null;
  useEffect(() => {
    if (itemPayload && view.dom.isConnected) view.dispatch({ effects: previewReference.of(itemPayload) });
  }, [itemPayload]);

  const startDisplay = (targets: DraftTarget[], text = selectedText) => {
    const candidates = candidateTemplates(templates, targets);
    setFilter('');
    setNotice(null);
    setDraft(candidates.length > 0 && targets.every((t) => t.kind !== 'term')
      ? { mode: 'template', display: candidates[0].name, text: '', targets }
      : { mode: 'text', text, targets });
  };

  const addTarget = (target: DraftTarget) => {
    const replace = adding?.replace;
    setDraft((d) => {
      if (!d) return d;
      const at = replace ? d.targets.findIndex((t) => t.path === replace) : -1;
      const rest = d.targets.filter((t) => t.path !== replace && t.path !== target.path);
      const targets = at >= 0 ? [...rest.slice(0, at), target, ...rest.slice(at)] : [...rest, target];
      return { ...d, targets };
    });
    setAdding(null);
    setQuery('');
    setNotice(null);
  };

  const removeTarget = (path: string) => {
    const targets = draft ? draft.targets.filter((t) => t.path !== path) : [];
    if (targets.length === 0 && !editing) {
      setDraft(null);
      view.dispatch({ effects: previewReference.of(null) });
      return;
    }
    setDraft((d) => (d ? { ...d, targets } : d));
  };

  const moveTarget = (path: string, step: number) => setDraft((d) => {
    if (!d) return d;
    const at = d.targets.findIndex((t) => t.path === path);
    const to = at + step;
    if (at < 0 || to < 0 || to >= d.targets.length) return d;
    const targets = [...d.targets];
    [targets[at], targets[to]] = [targets[to], targets[at]];
    return { ...d, targets };
  });

  const chooseHit = (hit: SearchHit | undefined, more = false) => {
    if (!hit) return;
    if (adding) {
      if (hit.kind === 'term' || hit.kind === 'target') addTarget(draftTarget(hit.target.path, byPath));
      else if (hit.kind === 'url') addTarget({ path: hit.url, kind: 'external' });
      else if (hit.kind === 'path') addTarget(draftTarget(hit.path, byPath));
      return;
    }
    if (hit.kind === 'self') finish(confirmSelfReferenceSpec(view.state));
    else if (hit.kind === 'term') {
      const text = selectedText || hit.text;
      if (more) startDisplay([draftTarget(hit.target.path, byPath)], text);
      else confirmItem({ text, target: hit.target.path });
    } else if (hit.kind === 'url') startDisplay([{ path: hit.url, kind: 'external' }]);
    else if (hit.kind === 'path') startDisplay([draftTarget(hit.path, byPath)]);
    else startDisplay([draftTarget(hit.target.path, byPath)]);
  };

  const picked = (result: ContentTargetObject | null) => {
    setPicking(false);
    if (!result) return;
    if (!result.path) {
      setNotice(`${result.label} can't be a reference target: a remark that nothing lists has no address, and the site doesn't number a claim inside a subsection or a details block.`);
      return;
    }
    const target = draftTarget(result.path, byPath);
    if (adding) addTarget(target);
    else startDisplay([target], selectedText || (target.kind === 'term' ? byPath.get(result.path)?.label ?? '' : ''));
  };
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  useEffect(() => selection.onTargetSelected(REFERENCE_POPUP_SELECTOR, (result) => pickedRef.current(result)), []);
  useEffect(() => () => { if (pickingRef.current) selection.onEndSelectTarget(null); }, []);

  const pickInSidebar = () => {
    setPicking(true);
    setNotice(null);
    selection.onBeginSelectTarget(REFERENCE_POPUP_SELECTOR, REFERENCE_TARGET_KINDS);
  };

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (popupRef.current?.contains(event.target as Node)) return;
      cancel();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  });

  const placement = useReferencePopupPlacement(popupRef, view, POPUP_WIDTH, cancel);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHitIndex((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHitIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); chooseHit(hits[hitIndex]); }
    else if (e.key === 'Tab' && !e.shiftKey && hits[hitIndex] && !adding) { e.preventDefault(); chooseHit(hits[hitIndex], true); }
    else if (e.key === '[' && !adding) {
      const action = secondBracketAction(query, request.insertTermMarker !== undefined);
      if (action === 'search') return;
      e.preventDefault();
      if (action === 'term-marker') {
        if (pickingRef.current) selection.onEndSelectTarget(null);
        request.insertTermMarker!();
        onClose();
      }
    } else if (e.key === '*' && query === '' && request.allowSelfReference && !adding) {
      e.preventDefault();
      finish(confirmSelfReferenceSpec(view.state));
    }
  };

  const candidates = draft ? candidateTemplates(templates, draft.targets) : [];
  const key = draft ? kindsKey(draft.targets.map((t) => t.kind)) : '';
  const previewOf = (name: string): Shown => (draft ? shownFor(buildReferenceItem({ ...draft, mode: 'template', display: name }, templates)) : { state: 'pending' });
  const previewText = (name: string) => {
    const shown = previewOf(name);
    return shown.state === 'rendered' ? textFromSegments(shown.segments) : undefined;
  };
  const listed = draft ? filterTemplates(candidates, filter, previewText) : [];

  const chooseTemplate = (name: string) => setDraft((d) => (d ? { ...d, mode: 'template', display: name } : d));
  const moveTemplate = (step: number) => {
    if (listed.length === 0) return;
    const at = listed.findIndex((t) => t.name === draft?.display);
    chooseTemplate(listed[Math.max(0, Math.min(listed.length - 1, at + step))].name);
  };
  const switchMode = (mode: 'template' | 'text') => setDraft((d) => {
    if (!d || d.mode === mode) return d;
    if (mode === 'template') return { ...d, mode, display: d.display ?? candidates[0]?.name };
    const rendered = item ? displays?.get(payloadOf(item)) : undefined;
    const text = d.text || (rendered && rendered.error === undefined ? textFromSegments(rendered.segments) : '');
    return { ...d, mode, text };
  });

  const confirmDraft = () => {
    if (!item || !draft) return;
    if (editing && leavesItemUnchanged(original?.item, draft, templates)) finish(cancelReferenceSpec());
    else confirmItem(item);
  };
  const remove = () => finish(removeReferenceSpec(view.state));
  const onDisplayKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter') { e.preventDefault(); confirmDraft(); }
    else if (draft?.mode === 'template' && e.key === 'ArrowDown') { e.preventDefault(); moveTemplate(1); }
    else if (draft?.mode === 'template' && e.key === 'ArrowUp') { e.preventDefault(); moveTemplate(-1); }
  };

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...(popupRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])];
    if (focusable.length === 0) return;
    const at = focusable.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? focusable.length - 1 : at - 1) : (at === focusable.length - 1 ? 0 : at + 1);
    e.preventDefault();
    focusable[next].focus();
  };

  const style = placement
    ? { top: placement.top, left: placement.left, width: POPUP_WIDTH, maxHeight: placement.maxHeight, maxWidth: placement.maxWidth }
    : { top: 0, left: 0, width: POPUP_WIDTH, opacity: 0 };

  let body: ReactNode;
  if (damaged) {
    body = <>
      <div className="ref-popup-message ref-popup-problem">{damaged}</div>
      <div className="ref-popup-footer">
        <span>Esc</span>
        <button ref={removeRef} className="ref-popup-btn" onClick={remove}>Remove</button>
      </div>
    </>;
  } else if (!choices && (editing || choicesError)) {
    body = <div className="ref-popup-message">{choicesError ? `The editor could not load what references can target: ${choicesError}` : 'Loading…'}</div>;
  } else if (choices?.error) {
    body = <div className="ref-popup-message ref-popup-problem">{choices.error}</div>;
  } else if (picking) {
    body = (
      <div className="ref-popup-section">
        <div className="ref-popup-message">Pick a chapter, section, entity, claim or term in the Content Explorer…</div>
        <div className="ref-popup-actions">
          <button ref={cancelPickRef} className="ref-popup-btn" onClick={() => selection.onEndSelectTarget(null)}>Cancel</button>
        </div>
      </div>
    );
  } else if (!draft || adding) {
    let group = '';
    body = <>
      <input ref={focusRef} className="ref-popup-input" value={query}
        placeholder={adding ? (adding.replace ? `Search for what replaces ${adding.replace}` : 'Search for a target to add') : 'Search terms, numbers and titles, or paste a URL'}
        onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} />
      <div className="ref-popup-list">
        {hits.length === 0 && <div className="ref-popup-message">{!choices ? 'Loading…' : query.trim() ? 'Nothing found.' : 'Type to search.'}</div>}
        {hits.map((hit, i) => {
          const heading = hitGroup(hit);
          const header = heading && heading !== group ? heading : null;
          group = heading;
          return (
            <div key={i}>
              {header && <div className="ref-popup-heading">{header}</div>}
              <HitRow hit={hit} selected={i === hitIndex} rowRef={i === hitIndex ? selectedRowRef : undefined} onPick={() => chooseHit(hit)} />
            </div>
          );
        })}
      </div>
      {notice && <div className="ref-popup-message ref-popup-problem">{notice}</div>}
      <div className="ref-popup-footer">
        <span>{adding ? 'Enter add · Esc' : 'Enter insert · Tab more · Esc'}</span>
        <span className="ref-popup-actions">
          {adding && <button className="ref-popup-btn" onClick={() => { setAdding(null); setQuery(''); }}>Back</button>}
          <button className="ref-popup-btn" disabled={selection.selectingSelectorId !== null} onClick={pickInSidebar}>Pick in sidebar</button>
        </span>
      </div>
    </>;
  } else {
    const textProblem = textModeProblem(draft);
    const template = draft.mode === 'template' ? templates.find((t) => t.name === draft.display) : undefined;
    const reorder = canReorder(draft, templates);
    const groups = targetGroups(orderedTargets(draft, templates), template, byPath);
    const heading = draft.targets.length < 2 ? 'Target'
      : reorder ? 'Targets'
      : `Targets (in reading order${template?.list && template.groupBy ? `, grouped by ${template.groupBy}` : ''})`;
    body = <>
      <div className="ref-popup-section">
        <div className="ref-popup-heading">{heading}</div>
        {groups.map((group, g) => (
          <div key={g}>
            {group.header && <div className="ref-popup-group">{group.header}</div>}
            {group.targets.map((target) => {
              const choice = byPath.get(target.path);
              const stale = !choice && REFERENCE_TARGET_KINDS.includes(target.kind);
              return (
                <div key={target.path} className="ref-popup-row ref-popup-row--static">
                  <TargetLine target={target} choice={choice} />
                  {stale && <span className="ref-popup-warning" title={`'${target.path}' is not in the content the editor loaded.`}>not found</span>}
                  {stale && <button className="ref-popup-btn" onClick={() => setAdding({ replace: target.path })}>Re-pick</button>}
                  {reorder && <>
                    <button className="ref-popup-icon-btn" title="Move up" onClick={() => moveTarget(target.path, -1)}>↑</button>
                    <button className="ref-popup-icon-btn ref-popup-icon-btn--next" title="Move down" onClick={() => moveTarget(target.path, 1)}>↓</button>
                  </>}
                  {(choice || target.kind === 'external') && (
                    <button className={`ref-popup-icon-btn${reorder ? ' ref-popup-icon-btn--next' : ''}`} title="Open"
                      onClick={() => selection.onOpenTarget(choice ? choice.id : target.path, choice ? choice.kind : 'external')}>↗</button>
                  )}
                  <button className="ref-popup-icon-btn ref-popup-icon-btn--next" title="Remove this target" onClick={() => removeTarget(target.path)}>✕</button>
                </div>
              );
            })}
          </div>
        ))}
        <button className="ref-popup-link-btn" onClick={() => { setAdding({}); setQuery(''); }}>+ Add target</button>
      </div>
      <div className="ref-popup-modes">
        <button className={`ref-popup-mode${draft.mode === 'template' ? ' ref-popup-mode--on' : ''}`} disabled={candidates.length === 0}
          title={candidates.length === 0 ? 'No display template takes this target.' : undefined} onClick={() => switchMode('template')}>Template</button>
        <button className={`ref-popup-mode${draft.mode === 'text' ? ' ref-popup-mode--on' : ''}`} disabled={textProblem !== undefined}
          title={textProblem} onClick={() => switchMode('text')}>Text</button>
        {draft.mode === 'template' && (
          <input ref={focusRef} className="ref-popup-input ref-popup-filter" value={filter} placeholder="filter"
            onChange={(e) => setFilter(e.target.value)} onKeyDown={onDisplayKey} />
        )}
      </div>
      {draft.mode === 'template' && problem && draft.targets.length > 0 && (
        <div className="ref-popup-message ref-popup-problem">! {problem}{listed.length > 0 ? '. Choose a template:' : ''}</div>
      )}
      {draft.mode === 'template' ? (
        <div className="ref-popup-list">
          {listed.length === 0 && <div className="ref-popup-message">No template matches.</div>}
          {listed.map((template) => {
            const selected = template.name === draft.display;
            return (
              <div key={template.name} ref={selected ? selectedRowRef : undefined}
                className={`ref-popup-row${selected ? ' ref-popup-row--selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); chooseTemplate(template.name); }}
                onDoubleClick={() => { if (!draftProblem({ ...draft, mode: 'template', display: template.name }, templates)) confirmItem(buildReferenceItem({ ...draft, mode: 'template', display: template.name }, templates)); }}>
                <Rendered shown={previewOf(template.name)} fallback={template.name} />
                <span className="ref-popup-dim ref-popup-name" title={template.name}>{template.name}</span>
                <span className="ref-popup-count">{template.uses[key] ?? ''}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ref-popup-section">
          <input ref={focusRef} className="ref-popup-input" value={draft.text} placeholder="Link text, with [...] around the link"
            onChange={(e) => { const text = e.target.value; setDraft((d) => (d ? { ...d, text } : d)); }} onKeyDown={onDisplayKey} />
        </div>
      )}
      <div className="ref-popup-section ref-popup-preview">
        <span className="ref-popup-heading">Preview</span>
        {item ? <Rendered shown={shownFor(item)} />
          : draft.mode === 'template' && draft.targets.length > 0 ? <span className="ref-popup-dim">none until the template takes the targets</span>
          : <span className="ref-popup-problem">{problem}</span>}
      </div>
      <div className="ref-popup-footer">
        <span>{editing ? 'Enter apply · Esc' : 'Enter insert · Esc'}</span>
        <span className="ref-popup-actions">
          {editing && <button className="ref-popup-btn" onClick={remove}>Remove</button>}
          <button className="ref-popup-btn ref-popup-btn--primary" disabled={!item} onClick={confirmDraft}>{editing ? 'Apply' : 'Insert'}</button>
        </span>
      </div>
    </>;
  }

  return (
    <div ref={popupRef} className={`ref-popup${placement ? ` ref-popup--${placement.side}` : ''}`} style={style} onKeyDown={trapTab}>
      {body}
    </div>
  );
}
