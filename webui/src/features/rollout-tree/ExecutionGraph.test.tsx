import { act, cleanup, render } from '@testing-library/react';
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
  expect(after.onNodesChange).toBe(before.onNodesChange);
  expect(after.nodesDraggable).toBe(true);
});

it('preserves dragged positions across polling and appended nodes without rebuilding edges during drag', () => {
  const nodes = [{ node_id: 'q', kind: 'query' }, { node_id: 'e', kind: 'execution', rollout_id: 'r' }] as TreeNode[];
  const edges = [{ source_node_id: 'q', target_node_id: 'e', kind: 'sequence' as const }];
  const onSelect = vi.fn();
  const { rerender } = render(<ExecutionGraph nodes={nodes} edges={edges} outcomes={{}} onSelect={onSelect} />);
  const before = flow.mock.lastCall![0];
  act(() => before.onNodesChange([{ type: 'position', id: 'e', position: { x: 450, y: 220 }, dragging: true }]));
  const dragging = flow.mock.lastCall![0];
  expect(dragging.nodes[1].position).toEqual({ x: 450, y: 220 });
  expect(dragging.nodes[0]).toBe(before.nodes[0]);
  expect(dragging.nodes[1].data).toBe(before.nodes[1].data);
  expect(dragging.edges).toBe(before.edges);
  act(() => dragging.onNodesChange([{ type: 'position', id: 'e', position: { x: 450, y: 220 }, dragging: false }]));
  rerender(<ExecutionGraph nodes={[...nodes.map(node => ({ ...node, summary: 'updated' })),
    { node_id: 'next', kind: 'execution', rollout_id: 'r' } as TreeNode]}
    edges={[...edges, { source_node_id: 'e', target_node_id: 'next', kind: 'sequence' }]}
    outcomes={{}} selectedId="e" onSelect={onSelect} />);
  const after = flow.mock.lastCall![0];
  expect(after.nodes.find((node: { id: string }) => node.id === 'e').position).toEqual({ x: 450, y: 220 });
  expect(after.nodes[1].data.node.summary).toBe('updated');
  expect(after.nodes[1].dragging).toBe(false);
  expect(after.nodes).toHaveLength(3);
  expect(onSelect).not.toHaveBeenCalled();
});

it('keeps edge objects stable across content-only updates and distinguishes execution states', () => {
  const nodes = [
    { node_id: 'q', kind: 'query' },
    { node_id: 'ok', kind: 'execution', status: 'succeeded' },
    { node_id: 'active', kind: 'execution', status: 'running' },
    { node_id: 'failed', kind: 'execution', status: 'failed' },
    { node_id: 'unknown', kind: 'execution', status: 'succeeded', terminal_unconfirmed: true },
  ] as TreeNode[];
  const edges = nodes.slice(1).map(node => ({
    source_node_id: 'q', target_node_id: node.node_id, kind: 'sequence' as const,
  }));
  const onSelect = vi.fn();
  const { rerender } = render(<ExecutionGraph nodes={nodes} edges={edges} outcomes={{}} onSelect={onSelect} />);
  const before = flow.mock.lastCall![0];
  expect(before.edges.map((edge: { type: string; data: { tone: string } }) => [edge.type, edge.data.tone]))
    .toEqual([['execution', 'success'], ['execution', 'running'], ['execution', 'failed'], ['execution', 'pending']]);
  rerender(<ExecutionGraph nodes={nodes.map(node => ({ ...node, summary: 'updated text' }))}
    edges={edges.map(edge => ({ ...edge }))} outcomes={{ result: { reward: 0 } }} onSelect={onSelect} />);
  const after = flow.mock.lastCall![0];
  expect(after.edges).toBe(before.edges);
  expect(after.edgeTypes).toBe(before.edgeTypes);
  expect(after.onNodeClick).toBe(before.onNodeClick);
});
