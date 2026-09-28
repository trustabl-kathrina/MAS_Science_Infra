import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Controls, Handle, Position, ReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { ancestorPath, executionPositions, type Positions } from './executionLayout';
import { ExecutionEdge, executionEdgeTone, type EdgeStateNode, type ExecutionFlowEdge } from './ExecutionEdge';
import { answerName, answerState, edgeId, executionName, rewardText } from './model';
import type { Outcome, TreeEdge, TreeNode } from './types';

type ExecutionNode = Node<{ node: TreeNode; outcome?: Outcome; highlighted: boolean; onSelect: (id: string) => void }, 'execution'>;
const ExecutionCard = memo(function ExecutionCard({ id, data, selected }: NodeProps<ExecutionNode>) {
  const { node, outcome } = data;
  const state = node.kind === 'execution' && node.status === 'succeeded'
    ? { label: '执行已完成', tone: 'neutral' } : answerState(node, outcome);
  return <div className={`sample-graph-node sample-execution-node${selected ? ' is-selected' : ''}${data.highlighted ? ' is-path' : ''}`}>
    {node.kind !== 'query' && <Handle type="target" position={Position.Left} isConnectable={false} />}
    <button className="nodrag nopan" onClick={event => { event.stopPropagation(); data.onSelect(id); }}>
      {node.kind === 'query' ? '问题' : node.kind === 'execution' ? executionName(node) : answerName(node.rollout_id || id)}
    </button>
    {node.kind !== 'query' && <span className={`sample-state is-${state.tone}`}>{state.label}</span>}
    {node.kind === 'outcome' && <span>最终奖励 <b>{rewardText(outcome?.reward)}</b></span>}
    <small className="sample-node-summary">{node.kind === 'outcome' ? outcome?.answer || '最终答案未记录' : node.summary}</small>
    {node.origin === 'independent_fill' && <small>独立补采样</small>}
    {node.kind !== 'outcome' && <Handle type="source" position={Position.Right} isConnectable={false} />}
  </div>;
}, (previous, next) => previous.id === next.id && previous.selected === next.selected
  && previous.data.node === next.data.node && previous.data.outcome === next.data.outcome
  && previous.data.highlighted === next.data.highlighted && previous.data.onSelect === next.data.onSelect);
const nodeTypes = { execution: ExecutionCard };
const edgeTypes = { execution: ExecutionEdge };
type Topology = { nodes: Pick<TreeNode, 'node_id' | 'kind' | 'rollout_id'>[]; edges: TreeEdge[] };

export default memo(function ExecutionGraph({ nodes, edges, outcomes, selectedId, onSelect }: {
  nodes: TreeNode[]; edges: TreeEdge[]; outcomes: Record<string, Outcome>; selectedId?: string; onSelect: (id: string) => void;
}) {
  const topology = JSON.stringify({ nodes: nodes.map(({ node_id, kind, rollout_id }) => ({ node_id, kind, rollout_id })), edges });
  const structure = useMemo<Topology>(() => JSON.parse(topology), [topology]);
  // Content/reward polling must not rebuild the edge objects or restart their animation.
  const edgeStates = JSON.stringify(nodes.map(({ node_id, kind, status, execution_error, terminal_unconfirmed }) =>
    ({ node_id, kind, status, execution_error, terminal_unconfirmed })));
  const stateById = useMemo(() => new Map((JSON.parse(edgeStates) as EdgeStateNode[]).map(node => [node.node_id, node])), [edgeStates]);
  const previous = useRef<Positions>(new Map());
  const positions = useMemo(() => executionPositions(structure.nodes, structure.edges, previous.current), [structure]);
  useLayoutEffect(() => { previous.current = positions; }, [positions]);
  const path = useMemo(() => ancestorPath(selectedId, structure.edges), [selectedId, structure]);
  const graphNodes = useMemo<ExecutionNode[]>(() => nodes.filter(node => positions.has(node.node_id)).map(node => ({
    id: node.node_id, type: 'execution', position: positions.get(node.node_id)!,
    selected: node.node_id === selectedId,
    data: { node, outcome: outcomes[node.node_id], highlighted: path.nodes.has(node.node_id), onSelect },
  })), [nodes, positions, outcomes, selectedId, path, onSelect]);
  const graphEdges = useMemo<ExecutionFlowEdge[]>(() => {
    const parallel = new Map<string, number>();
    for (const edge of structure.edges) if (edge.kind === 'sequence') parallel.set(edge.source_node_id, (parallel.get(edge.source_node_id) || 0) + 1);
    return structure.edges.filter(edge => positions.has(edge.source_node_id) && positions.has(edge.target_node_id)).map(edge => ({
      id: edgeId(edge), source: edge.source_node_id, target: edge.target_node_id, type: 'execution',
      label: edge.kind === 'branch' ? `续采样${edge.site_id ? ` · ${edge.site_id}` : ''}`
        : stateById.get(edge.source_node_id)?.kind !== 'query' && (parallel.get(edge.source_node_id) || 0) > 1 ? '并行' : undefined,
      data: { tone: executionEdgeTone(stateById.get(edge.source_node_id)!, stateById.get(edge.target_node_id)!),
        highlighted: path.edges.has(edgeId(edge)) },
      selectable: false, focusable: false,
    }));
  }, [structure, stateById, positions, path]);
  const onNodeClick = useCallback((_: React.MouseEvent, node: ExecutionNode) => onSelect(node.id), [onSelect]);
  return <div className="sample-graph sample-execution-graph" aria-label="横向执行树">
    {positions.size !== nodes.length && <p className="sample-graph-note">部分节点关系异常，暂不能布局；已保留可读取的记录。</p>}
    <ReactFlow nodes={graphNodes} edges={graphEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView
      nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false}
      deleteKeyCode={null} minZoom={0.15} maxZoom={1.5} proOptions={{ hideAttribution: true }}
      onNodeClick={onNodeClick}>
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>;
});
