import { memo, useMemo } from 'react';
import { ReactFlow, Handle, Position, Controls, type Node, type NodeProps, type Edge } from '@xyflow/react';
import { answerName, answerSource, answerState, forestPositions, rewardText } from './model';
import type { TreeNode, Outcome } from './types';
import { SampleState } from './SampleState';
import { useDraggableNodes } from './useDraggableNodes';

type AnswerNode = Node<{ title: string; state: string; tone: string; reward: string; source: string;
  onSelect: (id: string) => void }, 'answer'>;
const GraphAnswer = memo(function GraphAnswer({ id, data, selected }: NodeProps<AnswerNode>) {
  return <div className={`sample-graph-node${selected ? ' is-selected' : ''}`}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <button type="button" className="nodrag nopan" onClick={event => {
      event.stopPropagation(); data.onSelect(id);
    }}>{data.title}</button><span className={`sample-state is-${data.tone}`}>{data.state}</span>
    <span>最终奖励 <b>{data.reward}</b></span><small>{data.source}</small>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>;
}, (previous, next) => previous.id === next.id && previous.selected === next.selected
  && previous.data.title === next.data.title && previous.data.state === next.data.state
  && previous.data.tone === next.data.tone && previous.data.reward === next.data.reward
  && previous.data.source === next.data.source && previous.data.onSelect === next.data.onSelect);
const NODE_TYPES = { answer: GraphAnswer };

export default memo(function BranchGraph({ nodes, outcomes, selectedId, onSelect }: {
  nodes: TreeNode[]; outcomes: Record<string, Outcome>; selectedId?: string; onSelect: (id: string) => void;
}) {
  const topology = useMemo(() => JSON.stringify(nodes.map(n => [n.node_id, n.parent_id, n.kind])), [nodes]);
  const positions = useMemo(() => {
    const entries: [string, string | null, TreeNode['kind']][] = JSON.parse(topology);
    return forestPositions(entries.map(([node_id, parent_id, kind]) => ({ node_id, parent_id, kind })));
  }, [topology]);
  const graphNodes = useMemo<AnswerNode[]>(() => nodes.filter(n => n.kind !== 'query').map(node => {
    const state = answerState(node, outcomes[node.node_id]);
    return { id: node.node_id, type: 'answer', position: positions.get(node.node_id) || { x: 0, y: 0 },
      selected: selectedId === node.node_id,
      data: { title: answerName(node.node_id), state: state.label, tone: state.tone,
        reward: rewardText(outcomes[node.node_id]?.reward), source: node.origin === 'branch' ? '从中间窗口重新生成' : answerSource(node),
        onSelect } };
  }), [nodes, outcomes, selectedId, positions, onSelect]);
  const draggable = useDraggableNodes(graphNodes);
  const edges = useMemo<Edge[]>(() => {
    const ids = new Set(nodes.filter(n => n.kind !== 'query').map(n => n.node_id));
    return nodes.filter(n => n.origin === 'branch' && n.parent_id && ids.has(n.parent_id)).map(n => ({
      id: `lineage:${n.node_id}`, source: n.parent_id!, target: n.node_id,
      type: 'smoothstep', label: n.site_id || '分支位置未记录',
      style: { stroke: '#91a5c0' }, labelStyle: { fontSize: 10 },
    }));
  }, [nodes]);
  if (!graphNodes.length) return <SampleState title="暂无可展示的分支关系" description="实际生成记录及其来源确认后，关系图将显示在这里。" />;
  return <div className="sample-graph" aria-label="回答分支关系图">
    {!edges.length && <p className="sample-graph-note">当前已加载记录无分支连线，独立回答不互相连接。</p>}
    <ReactFlow nodes={draggable.nodes} onNodesChange={draggable.onNodesChange} edges={edges} nodeTypes={NODE_TYPES} fitView
      nodesDraggable nodesConnectable={false} edgesReconnectable={false}
      deleteKeyCode={null} minZoom={0.15} maxZoom={1.5} proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => onSelect(node.id)}>
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>;
});
