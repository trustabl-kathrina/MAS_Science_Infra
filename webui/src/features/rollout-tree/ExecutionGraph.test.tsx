import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TreeNode } from './types';

const { flow } = vi.hoisted(() => ({ flow: vi.fn() }));
vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: unknown) => { flow(props); return null; },
  Controls: () => null, Handle: () => null, Position: { Left: 'left', Right: 'right' },
}));
import ExecutionGraph from './ExecutionGraph';
afterEach(cleanup);

it('updates node content without recreating positions or fitting the viewport again', () => {
  const nodes = [{ node_id: 'q', kind: 'query' }, { node_id: 'e', kind: 'execution', rollout_id: 'r', status: 'running' },
    { node_id: 'result', kind: 'outcome', rollout_id: 'r' }] as TreeNode[];
  const edges = [{ source_node_id: 'q', target_node_id: 'e', kind: 'sequence' as const },
    { source_node_id: 'e', target_node_id: 'result', kind: 'sequence' as const }];
  const onSelect = vi.fn();
  const { rerender } = render(<ExecutionGraph nodes={nodes} edges={edges} outcomes={{}} onSelect={onSelect} />);
  const before = flow.mock.lastCall![0];
  rerender(<ExecutionGraph nodes={nodes.map(node => ({ ...node, status: 'succeeded', summary: '真实新增输出' }))}
    edges={edges} outcomes={{ result: { reward: 0 } }} selectedId="result" onSelect={onSelect} />);
  const after = flow.mock.lastCall![0];
  for (let i = 0; i < before.nodes.length; i++) expect(after.nodes[i].position).toBe(before.nodes[i].position);
  expect(after.nodes[1].data.node.summary).toBe('真实新增输出');
  expect(after.nodes[2].data.outcome.reward).toBe(0);
  expect(after.nodes.every((node: { data: { highlighted: boolean } }) => node.data.highlighted)).toBe(true);
  expect(after.onInit).toBeUndefined();
  expect(after.onNodesChange).toBeUndefined();
});
