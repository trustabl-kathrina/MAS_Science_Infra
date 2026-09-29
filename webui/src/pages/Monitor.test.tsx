import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorPanel } from './Monitor';

vi.mock('../app/providers/RuntimeProvider', () => ({
  useRuntimeCommands: () => ({ viewTraining: vi.fn(), startTrain: vi.fn(), stopTrain: vi.fn(), diagnose: vi.fn() }),
}));

afterEach(() => cleanup());

const props = {
  expId: 'exp',
  model: { experiment_id: 'exp', rewards: [], empty: true },
  error: null,
  loading: false,
  onRefresh: async () => {},
  trainRunId: 'run-1',
  trainRunning: true,
  aglOnline: false,
  onRefreshLog: async () => {},
  visible: true,
};

describe('MonitorPanel log', () => {
  it('shows the current train log and clears it when the log becomes empty', () => {
    const { rerender } = render(<MonitorPanel {...props} trainLog="alpha-line" />);
    expect(screen.getByText('alpha-line')).toBeTruthy();
    rerender(<MonitorPanel {...props} trainLog="" trainRunId="run-2" />);
    expect(screen.queryByText('alpha-line')).toBeNull();
    expect(screen.getByText('尚无训练 stdout')).toBeTruthy();
  });
});
