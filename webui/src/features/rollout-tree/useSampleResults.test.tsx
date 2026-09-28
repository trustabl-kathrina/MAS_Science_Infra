import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSampleResults } from './useSampleResults';
import type { TreeDetail } from './types';

const treeId = 'a'.repeat(32);
function response(revision = 1, cursor: string | null = null): TreeDetail {
  return { experiment_id: 'exp', run_id: 'abcdef123456', run_state: 'running',
    tree: { tree_id: treeId, query: 'q', query_truncated: false, mode: 'train', group_id: 'g',
      revision, updated_at: null, nodes: [], pending_nodes: [], outcomes: {}, plans: [], issues: [] },
    page: { total: 200, next_cursor: cursor, truncated: !!cursor, plan_total: 0, next_plan_offset: null } };
}
function mockRequests(treeRead: (url: string, signal: AbortSignal) => Promise<Response>) {
  const fetch = vi.fn((url: string, init: RequestInit) => {
    if (url.includes('/rollout-trees/')) return treeRead(url, init.signal as AbortSignal);
    if (url.includes('/rollout-trees?')) return Promise.resolve(new Response(JSON.stringify({
      experiment_id: 'exp', run_id: 'abcdef123456', run_state: 'running', items: [], total: 0,
      next_offset: null, availability: 'empty', recording_status: 'ready',
    })));
    return Promise.resolve(new Response(JSON.stringify({ run_id: 'abcdef123456', state: 'running' })));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('sample result loading', () => {
  it('does not mix revisions after cursor invalidation', async () => {
    let revision = 1;
    mockRequests(async url => {
      if (url.includes('cursor=')) {
        if (revision === 1) { revision = 2; return new Response('{"detail":"changed"}', { status: 409 }); }
        return new Response(JSON.stringify(response(2)));
      }
      return new Response(JSON.stringify(response(revision, `${revision}:100`)));
    });
    const { result } = renderHook(() => useSampleResults('exp', 'abcdef123456', treeId, undefined, true));
    await waitFor(() => expect(result.current.detail.data?.tree.revision).toBe(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.detail.data?.tree.revision).toBe(2));
    expect(result.current.detail.error).toBeNull();
  });
  it('bounds deep-link lookup and does not call missing records nonexistent', async () => {
    let calls = 0;
    mockRequests(async () => {
      calls++;
      return new Response(JSON.stringify(response(1, `1:${calls * 100}`)));
    });
    const { result } = renderHook(() => useSampleResults('exp', 'abcdef123456', treeId, 'missing', true));
    await waitFor(() => expect(result.current.detail.data?.lookup_node_id).toBe('missing'));
    expect(calls).toBeLessThanOrEqual(6); // Five pages, plus possible coalesced first-page refresh.
    expect(result.current.detail.data?.page.next_cursor).not.toBeNull();
  });
  it('cancels reads when hidden and keeps loaded data when refresh fails', async () => {
    let fail = false;
    const signals: AbortSignal[] = [];
    mockRequests(async (_, signal) => {
      signals.push(signal);
      return fail ? new Response('offline', { status: 503 }) : new Response(JSON.stringify(response()));
    });
    const { result, rerender } = renderHook(({ active }) =>
      useSampleResults('exp', 'abcdef123456', treeId, undefined, active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current.detail.data).not.toBeNull());
    fail = true;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.detail.error).toBe('offline'));
    expect(result.current.detail.data?.tree.tree_id).toBe(treeId);
    rerender({ active: false });
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });
});
