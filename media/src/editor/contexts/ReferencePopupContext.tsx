import { createContext, useContext } from 'react';
import type { EditorView } from '@codemirror/view';

/** What a text field asks the panel's reference popup to do: create a reference at a range, or edit a token. */
export interface ReferencePopupRequest {
  view: EditorView;
  mode: 'create' | 'edit';
  from: number;
  to: number;
  /** The create popup's search to start with: the selected words, or nothing. */
  query: string;
  /** The figure lead-in, where `[*]` is the figure's self-reference. */
  allowSelfReference: boolean;
  /** Closes the popup and puts `[[]]` at the caret, where a field can hold a term marker. */
  insertTermMarker?: () => void;
}

export interface ReferencePopupHost {
  open(request: ReferencePopupRequest): void;
}

export const ReferencePopupContext = createContext<ReferencePopupHost | null>(null);

/** The panel's reference popup, or null where there is none, and `[` is a plain character. */
export function useReferencePopupHost(): ReferencePopupHost | null {
  return useContext(ReferencePopupContext);
}
