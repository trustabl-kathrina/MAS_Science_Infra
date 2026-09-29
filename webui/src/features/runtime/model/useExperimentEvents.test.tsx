import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useExperimentEvents } from './useExperimentEvents';

class FakeEventSource {
  static latest: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) { FakeEventSource.latest = this; }
  close() {}
  emit(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

afterEach(() => { FakeEventSource.latest = null; vi.unstubAllGlobals(); });

describe('useExperimentEvents', () => {
  it('refreshes training on train events and ignores other experiments', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onTrain = vi.fn(async () => {});
    const onEvent = vi.fn(async () => {});
    const { result } = renderHook(() => useExperimentEvents('exp', onTrain, onEvent, true));
    await waitFor(() => expect(FakeEventSource.latest).toBeTruthy());
    FakeEventSource.latest?.onopen?.();
    FakeEventSource.latest?.emit({ type: 'train_started', experiment_id: 'exp' });
    await waitFor(() => expect(onTrain).toHaveBeenCalledTimes(1));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(result.current.latest).toBe('train_started');

    FakeEventSource.latest?.emit({ type: 'collect_progress', experiment_id: 'exp' });
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2));
    expect(onTrain).toHaveBeenCalledTimes(1);

    FakeEventSource.latest?.emit({ type: 'train_done', experiment_id: 'other' });
    expect(onTrain).toHaveBeenCalledTimes(1);
    expect(result.current.latest).toBe('collect_progress');
  });
});
