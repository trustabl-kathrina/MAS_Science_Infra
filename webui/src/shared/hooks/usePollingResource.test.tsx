import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePollingResource } from './usePollingResource';

describe('usePollingResource', () => {
  it('does not poll while disabled', () => {
    const load = vi.fn(async () => 'value');
    renderHook(() => usePollingResource('hidden', load, 20, false));
    expect(load).not.toHaveBeenCalled();
  });

  it('drops a response after the key changes', async () => {
    const resolvers: Array<(value: string) => void> = [];
    const load = vi.fn(() => new Promise<string>(resolve => { resolvers.push(resolve); }));
    const { result, rerender } = renderHook(
      ({ key }) => usePollingResource(key, load),
      { initialProps: { key: 'exp-a' } },
    );
    await waitFor(() => expect(resolvers).toHaveLength(1));
    rerender({ key: 'exp-b' });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[0]('stale-a');
    resolvers[1]('fresh-b');
    await waitFor(() => expect(result.current.data).toBe('fresh-b'));
    expect(result.current.data).not.toBe('stale-a');
  });
});
