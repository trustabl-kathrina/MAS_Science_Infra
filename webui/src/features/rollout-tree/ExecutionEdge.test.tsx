import { cleanup, render } from '@testing-library/react';
import { Position, type EdgeProps } from '@xyflow/react';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { ExecutionEdge, executionEdgeTone, type EdgeStateNode, type ExecutionFlowEdge } from './ExecutionEdge';

afterEach(cleanup);
const originalBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
beforeAll(() => {
  // jsdom does not implement SVG text measurement used by React Flow labels.
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true, value: () => ({ x: 0, y: 0, width: 80, height: 14 }),
  });
});
afterAll(() => {
  if (originalBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', originalBBox);
  else Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
});

const props: EdgeProps<ExecutionFlowEdge> = {
  id: 'a-b', source: 'a', target: 'b', type: 'execution',
  sourceX: 218, sourceY: 21, targetX: 300, targetY: 171,
  sourcePosition: Position.Right, targetPosition: Position.Left,
  data: { tone: 'success', highlighted: false },
};

it('uses one smooth curve for the base and CSS flow overlay, preserving branch labels', () => {
  const { container, rerender } = render(<svg><ExecutionEdge {...props} label="续采样 · Python" /></svg>);
  const path = container.querySelector('.sample-execution-edge-line')!;
  const flow = container.querySelector('.sample-execution-edge-flow')!;
  expect(path.getAttribute('d')).toContain('C');
  expect(flow.getAttribute('d')).toBe(path.getAttribute('d'));
  expect(container.textContent).toContain('续采样 · Python');
  expect(container.querySelector('.sample-execution-edge')?.classList.contains('is-success')).toBe(true);
  rerender(<svg><ExecutionEdge {...props} data={{ tone: 'failed', highlighted: true }} /></svg>);
  expect(container.querySelector('.sample-execution-edge-flow')).toBeNull();
  expect(container.querySelector('.sample-execution-edge')?.classList.contains('is-failed')).toBe(true);
  expect(container.querySelector('.sample-execution-edge')?.classList.contains('is-highlighted')).toBe(true);
});

it('never treats failed, cancelled or unconfirmed execution as a successful path', () => {
  const source: EdgeStateNode = { node_id: 'a', kind: 'execution', status: 'succeeded', execution_error: null };
  expect(executionEdgeTone(source, { ...source, node_id: 'b' })).toBe('success');
  expect(executionEdgeTone(source, { ...source, status: 'running' })).toBe('running');
  expect(executionEdgeTone(source, { ...source, status: 'cancelled' })).toBe('pending');
  expect(executionEdgeTone(source, { ...source, terminal_unconfirmed: true })).toBe('pending');
  expect(executionEdgeTone({ ...source, status: 'failed' }, source)).toBe('failed');
  expect(executionEdgeTone(source, { ...source, execution_error: 'timeout' })).toBe('failed');
  expect(executionEdgeTone({ ...source, status: null }, source)).toBe('pending');
});
