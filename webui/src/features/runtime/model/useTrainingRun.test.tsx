import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeApi } from '../api';
import { useTrainingRun } from './useTrainingRun';

vi.mock('../api', () => ({
  runtimeApi: {
    trainingActivity: vi.fn(),
    trainingRun: vi.fn(),
  },
}));

const activity = vi.mocked(runtimeApi.trainingActivity);
const trainingRun = vi.mocked(runtimeApi.trainingRun);

beforeEach(() => {
  activity.mockReset();
  trainingRun.mockReset();
});

describe('useTrainingRun', () => {
  it('keeps the last run and reports it stopped after success', async () => {
    activity.mockResolvedValueOnce({
      run: { run_id: 'r1', state: 'running', running: true, meta: {} },
    } as never);
    const { result } = renderHook(() => useTrainingRun('exp', true));
    await waitFor(() => expect(result.current.data?.running).toBe(true));
    expect(result.current.data?.state).toBe('running');

    activity.mockResolvedValue({ run: null });
    trainingRun.mockResolvedValue({
      run_id: 'r1', state: 'succeeded', running: false, message: null, meta: {},
    } as never);
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.data?.state).toBe('succeeded'));
    expect(result.current.data?.running).toBe(false);
    expect(result.current.data?.runId).toBe('r1');
    expect(trainingRun).toHaveBeenCalledWith('exp', 'r1', expect.any(AbortSignal));
  });
});
