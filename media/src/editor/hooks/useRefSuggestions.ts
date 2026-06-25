import { useCallback, useRef } from 'react';
import { useClient } from '../../shared/clientContext';
import { fold } from '../textFold';
import type {
  ContentObjectData,
  ContentTargetObject,
  GetReferenceSuggestionsRequest,
  GetReferenceSuggestionsResponse,
  RefSuggestion,
} from '../../shared/types';

interface Params {
  nodeId:           string;
  draftRef:         React.MutableRefObject<ContentObjectData | null>;
  targetObjectsRef: React.MutableRefObject<Record<string, ContentTargetObject>>;
}

function cmp(a: RefSuggestion, b: RefSuggestion): number {
  const n = a.name.localeCompare(b.name);                if (n) return n;
  const d = a.display.localeCompare(b.display);          if (d) return d;
  return a.target.label.localeCompare(b.target.label);
}

export function useRefSuggestions({ nodeId, draftRef, targetObjectsRef }: Params): (query: string) => Promise<RefSuggestion[]> {
  const client = useClient();
  const fetchIdRef = useRef(0);

  return useCallback(async (query: string): Promise<RefSuggestion[]> => {
    const fetchId = ++fetchIdRef.current;
    const resp = await client.request<GetReferenceSuggestionsResponse>(
      'getReferenceSuggestions',
      { currentObjectId: nodeId } as GetReferenceSuggestionsRequest,
    );
    if (fetchIdRef.current !== fetchId) return [];

    // Derive source:'current' from the live draft (discarding the host's snapshot).
    const draft = draftRef.current;
    const targetObjects = targetObjectsRef.current;
    const cur: RefSuggestion[] = [];
    if (draft) {
      for (const r of draft.references) {
        if (!r.display) continue;
        if (!r.targetId) continue;
        const target = targetObjects[r.targetId];
        if (!target) continue;
        cur.push({ source: 'current', name: r.name, display: r.display, target });
      }
    }
    const currentNames = new Set(cur.map(r => r.name));

    // Take the host's source:'other' entries; drop any whose name collides with a current-object ref;
    // dedupe by name so each ref key contributes a single row (the same ref name typically appears
    // in many files — keep the first occurrence per name).
    const seenOtherNames = new Set<string>();
    const oth: RefSuggestion[] = [];
    for (const s of resp.suggestions) {
      if (s.source !== 'other') continue;
      if (currentNames.has(s.name)) continue;
      if (seenOtherNames.has(s.name)) continue;
      seenOtherNames.add(s.name);
      oth.push(s);
    }

    const fq = fold(query).toLowerCase();

    // Empty query: just both groups starts-with-empty (= everything), alphabetically.
    if (fq === '') return [...cur.sort(cmp), ...oth.sort(cmp)];

    const nameOf    = (r: RefSuggestion) => fold(r.name).toLowerCase();
    const displayOf = (r: RefSuggestion) => fold(r.display).toLowerCase();
    const labelOf   = (r: RefSuggestion) => fold(r.target.label).toLowerCase();

    const startsName    = (r: RefSuggestion) => nameOf(r).startsWith(fq);
    const containsName  = (r: RefSuggestion) => !startsName(r) && nameOf(r).includes(fq);
    const startsDisp    = (r: RefSuggestion) =>
      !nameOf(r).includes(fq) && displayOf(r).startsWith(fq);
    const containsDisp  = (r: RefSuggestion) =>
      !nameOf(r).includes(fq) && !displayOf(r).startsWith(fq) && displayOf(r).includes(fq);
    const startsLabel   = (r: RefSuggestion) =>
      !nameOf(r).includes(fq) && !displayOf(r).includes(fq) && labelOf(r).startsWith(fq);
    const containsLabel = (r: RefSuggestion) =>
      !nameOf(r).includes(fq) && !displayOf(r).includes(fq) &&
      !labelOf(r).startsWith(fq) && labelOf(r).includes(fq);

    return [
      ...cur.filter(startsName   ).sort(cmp),
      ...cur.filter(containsName ).sort(cmp),
      ...cur.filter(startsDisp   ).sort(cmp),
      ...cur.filter(containsDisp ).sort(cmp),
      ...oth.filter(startsName   ).sort(cmp),
      ...oth.filter(containsName ).sort(cmp),
      ...oth.filter(startsDisp   ).sort(cmp),
      ...oth.filter(containsDisp ).sort(cmp),
      ...oth.filter(startsLabel  ).sort(cmp),
      ...oth.filter(containsLabel).sort(cmp),
    ];
  }, [nodeId]);
}
