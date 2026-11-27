import { createContext, useContext } from 'react';
import type { MessageClient } from '../shared/messageClient';
import type { ReferenceTokenDisplay, ResolveReferenceTokensResponse, ResolveSelfReferenceResponse } from '../shared/types';

/** The rendered references a text field shows, by token payload. */
export interface ReferenceDisplaySource {
  /** The display, or undefined while it is being rendered. */
  get(payload: string): ReferenceTokenDisplay | undefined;
  /** Called whenever a display arrives or changes. */
  subscribe(listener: () => void): () => void;
  /** Counts the refreshes, after which a figure's self-reference is asked for again. */
  readonly revision: number;
  /** The `[*]` of the figure `blockId` as the site shows it with `display`. */
  resolveSelfReference(blockId: string, display: string): Promise<ReferenceTokenDisplay>;
}

/**
 * A panel's rendered references. The host renders them, since it holds the
 * templates and the numbering: a payload the panel hasn't seen is asked for on
 * first use, together with the others asked for in the same turn. `refresh` asks
 * again for every one, and the old display stays until the new one arrives.
 */
export class ReferenceDisplayStore implements ReferenceDisplaySource {
  private readonly displays = new Map<string, ReferenceTokenDisplay>();
  private readonly requested = new Set<string>();
  private readonly queued = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  constructor(private readonly client: MessageClient, private readonly ownerId: string) {}

  get(payload: string): ReferenceTokenDisplay | undefined {
    if (!this.requested.has(payload)) this.queue(payload);
    return this.displays.get(payload);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get revision(): number {
    return this.generation;
  }

  resolveSelfReference(blockId: string, display: string): Promise<ReferenceTokenDisplay> {
    return this.client.request<ResolveSelfReferenceResponse>('resolveSelfReference', { id: this.ownerId, blockId, display })
      .then((response) => response.display);
  }

  refresh(): void {
    this.generation++;
    const known = [...this.requested];
    this.requested.clear();
    this.queued.clear();
    for (const payload of known) this.queue(payload);
    for (const listener of [...this.listeners]) listener();
  }

  private queue(payload: string): void {
    this.requested.add(payload);
    this.queued.add(payload);
    if (this.queued.size === 1) queueMicrotask(() => this.flush());
  }

  private flush(): void {
    const payloads = [...this.queued];
    this.queued.clear();
    if (payloads.length === 0) return;
    const generation = this.generation;
    const settle = (displays: Record<string, ReferenceTokenDisplay>) => {
      if (generation !== this.generation) return;
      for (const [payload, display] of Object.entries(displays)) this.displays.set(payload, display);
      for (const listener of [...this.listeners]) listener();
    };
    this.client.request<ResolveReferenceTokensResponse>('resolveReferenceTokens', { id: this.ownerId, payloads })
      .then(({ displays }) => settle(displays))
      .catch((err: Error) => settle(Object.fromEntries(payloads.map((payload) =>
        [payload, { error: `The editor could not render this reference: ${err.message}` }]))));
  }
}

export const ReferenceDisplaysContext = createContext<ReferenceDisplaySource | null>(null);

export function useReferenceDisplays(): ReferenceDisplaySource | null {
  return useContext(ReferenceDisplaysContext);
}
