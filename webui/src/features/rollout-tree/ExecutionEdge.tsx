import { memo } from 'react';
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { TreeNode } from './types';

export type EdgeStateNode = Pick<TreeNode, 'node_id' | 'kind' | 'status' | 'execution_error' | 'terminal_unconfirmed'>;
export type ExecutionEdgeTone = 'success' | 'running' | 'failed' | 'pending';
export type ExecutionFlowEdge = Edge<{ tone: ExecutionEdgeTone; highlighted: boolean }, 'execution'>;

export function executionEdgeTone(source: EdgeStateNode, target: EdgeStateNode): ExecutionEdgeTone {
  if ([source, target].some(node => node.status === 'failed' || node.execution_error)) return 'failed';
  if ([source, target].some(node => node.terminal_unconfirmed || node.status === 'cancelled')) return 'pending';
  if (source.kind !== 'query' && source.status !== 'succeeded') return 'pending';
  if (target.status === 'running') return 'running';
  return target.status === 'succeeded' ? 'success' : 'pending';
}

const labelStyle = { fill: 'var(--text-secondary)', fontSize: 10 };
const labelBackground = { fill: 'var(--surface)', fillOpacity: 0.95 };
const labelPadding: [number, number] = [7, 4];

export const ExecutionEdge = memo(function ExecutionEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, data,
}: EdgeProps<ExecutionFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35,
  });
  const tone = data?.tone || 'pending';
  return <g className={`sample-execution-edge is-${tone}${data?.highlighted ? ' is-highlighted' : ''}`}>
    <BaseEdge id={id} path={path} className="sample-execution-edge-line" interactionWidth={0}
      label={label} labelX={labelX} labelY={labelY} labelStyle={labelStyle}
      labelBgStyle={labelBackground} labelBgPadding={labelPadding} labelBgBorderRadius={5} />
    {(tone === 'success' || tone === 'running') && <path d={path} className="sample-execution-edge-flow"
      fill="none" pointerEvents="none" aria-hidden="true" />}
  </g>;
}, (previous, next) => previous.id === next.id && previous.sourceX === next.sourceX
  && previous.sourceY === next.sourceY && previous.targetX === next.targetX && previous.targetY === next.targetY
  && previous.sourcePosition === next.sourcePosition && previous.targetPosition === next.targetPosition
  && previous.label === next.label && previous.data?.tone === next.data?.tone
  && previous.data?.highlighted === next.data?.highlighted);
