import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SampleSelection } from '../../app/navigation';
import type { TreeDetail, TreeNode } from './types';

const { mockState } = vi.hoisted(() => ({ mockState: vi.fn() }));
vi.mock('./useSampleResults', () => ({ useSampleResults: mockState }));
vi.mock('../../app/providers/RuntimeProvider', () => ({ useRuntimeCommands: () => ({ viewTraining: vi.fn() }) }));
vi.mock('../training/components/TrainingConsole', () => ({
  Snapshot: () => <button>本次配置</button>, TRAIN_STATE: { running: '运行中', succeeded: '已完成' },
}));
vi.mock('./BranchGraph', () => ({ default: ({ onSelect }: { onSelect: (id: string) => void }) =>
  <button onClick={() => onSelect('child')}>树中回答 child</button> }));
import { SampleResults } from './SampleResults';

const parent: TreeNode = {
  node_id: 'parent', parent_id: 'query', kind: 'rollout', origin: 'initial',
  status: 'succeeded', store_status: 'succeeded', training_status: null, record_issues: [],
  attempt_id: 'attempt', attempt_sequence: 1, site_id: null, window_id: null,
  event_id: null, boundary_snapshot_ref: null, reward: null, verdict: null,
  execution_error: null, judgments: [], previous_attempts: [], metrics: {}, decision: {},
};
const data: TreeDetail = {
  experiment_id: 'exp', run_id: 'abcdef123456', run_state: 'running',
  tree: { tree_id: 'a'.repeat(32), query: '真实题目', query_truncated: false,
    group_id: 'group', mode: 'train', revision: 1, updated_at: null,
    nodes: [parent, { ...parent, node_id: 'child', parent_id: 'parent', origin: 'branch' }],
    pending_nodes: [], plans: [], issues: [], outcomes: {
      parent: { answer: '父回答内容', reward: 0 }, child: { answer: '子回答内容', reward: 0.5 },
    } },
  page: { total: 2, next_cursor: null, truncated: false, plan_total: 0, next_plan_offset: null },
};
function Harness() {
  const [selection, setSelection] = useState<SampleSelection>({
    runId: data.run_id, treeId: data.tree.tree_id, view: 'answers',
  });
  return <SampleResults experimentId="exp" selection={selection} active onNavigate={setSelection} onBack={vi.fn()} />;
}
afterEach(cleanup);

it('starts with answers and opens the same detail from either view without automatic switching', async () => {
  const resource = (value: unknown) => ({ data: value, loading: false, error: null, refresh: vi.fn() });
  mockState.mockReturnValue({
    run: resource({ state: 'running' }), list: resource({ items: [], total: 0 }), detail: resource(data),
    offset: 0, mode: '', refresh: vi.fn(), filter: vi.fn(), setOffset: vi.fn(), resetWindow: vi.fn(),
    pages: 1, planPages: 1,
  });
  render(<Harness />);
  expect(screen.getByRole('button', { name: '回答列表' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByLabelText('回答 child详情')).toBeNull();
  expect(screen.queryByText('树中回答 child')).toBeNull();
  expect(screen.getByText('父回答内容')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: '查看详情' })[1]);
  expect(screen.getByLabelText('回答 child详情')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '分支关系' }));
  await waitFor(() => expect(screen.getByText('树中回答 child')).toBeTruthy());
  expect(screen.getByLabelText('回答 child详情')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭回答详情' }));
  expect(screen.queryByLabelText('回答 child详情')).toBeNull();
  fireEvent.click(screen.getByText('树中回答 child'));
  expect(screen.getByLabelText('回答 child详情')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看来源回答' }));
  expect(screen.getByLabelText('回答 parent详情')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '回答列表' }));
  expect(screen.getByLabelText('回答 parent详情')).toBeTruthy();
  expect(screen.queryByText('Agent 执行过程')).toBeNull();
});
