import { useEffect, useReducer, useState } from 'react';
import { useReferenceDisplays } from '../referenceDisplays';
import type { SelfReferenceDisplay } from '../referenceTokens';

/** What the `[*]` of the figure `blockId` shows with the self-reference `display` the panel holds, asked again after each refresh. */
export function useSelfReferenceDisplay(blockId: string, display: string): SelfReferenceDisplay {
  const displays = useReferenceDisplays();
  const [shown, setShown] = useState<SelfReferenceDisplay>('pending');
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => displays?.subscribe(rerender), [displays]);
  const revision = displays?.revision ?? 0;
  useEffect(() => {
    if (!displays) return;
    let live = true;
    displays.resolveSelfReference(blockId, display).then(
      (result) => { if (live) setShown(result); },
      (err: Error) => { if (live) setShown({ error: `The editor could not render this self-reference: ${err.message}` }); },
    );
    return () => { live = false; };
  }, [displays, blockId, display, revision]);
  return displays ? shown : 'pending';
}
