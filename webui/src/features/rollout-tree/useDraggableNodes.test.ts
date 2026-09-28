import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { useDraggableNodes } from './useDraggableNodes';

it('ignores non-position edits and releases positions when nodes leave the mounted graph', () => {
  const nodes: Node[] = [{ id: 'a', position: { x: 0, y: 0 }, data: {} }];
  const { result, rerender } = renderHook(({ nodes }) => useDraggableNodes(nodes), { initialProps: { nodes } });
  const original = result.current.nodes;
  act(() => result.current.onNodesChange([{ type: 'remove', id: 'a' }, { type: 'select', id: 'a', selected: true }]));
  expect(result.current.nodes).toBe(original);
  act(() => result.current.onNodesChange([{ type: 'position', id: 'a', position: { x: 40, y: 50 }, dragging: false }]));
  const moved = result.current.nodes;
  act(() => result.current.onNodesChange([{ type: 'position', id: 'a', position: { x: 40, y: 50 }, dragging: false }]));
  expect(result.current.nodes).toBe(moved);
  rerender({ nodes: [] });
  rerender({ nodes });
  expect(result.current.nodes[0].position).toEqual({ x: 0, y: 0 });
});
