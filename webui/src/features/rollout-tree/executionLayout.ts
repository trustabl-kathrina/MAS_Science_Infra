import type { TreeEdge, TreeNode } from './types';
import { edgeId } from './model';

export type Positions = Map<string, { x: number; y: number }>;
type LayoutNode = Pick<TreeNode, 'node_id' | 'kind' | 'rollout_id'>;

// Longest topological depth respects every parallel input, not just parent_id.
// Existing lanes survive appended suffixes; content/state never enter this model.
export function executionPositions(nodes: LayoutNode[], edges: TreeEdge[], previous: Positions = new Map()): Positions {
  const ids = new Set(nodes.map(node => node.node_id));
  const incoming = new Map<string, TreeEdge[]>();
  const outgoing = new Map<string, TreeEdge[]>();
  for (const edge of edges) {
    if (!ids.has(edge.source_node_id) || !ids.has(edge.target_node_id)) continue;
    incoming.set(edge.target_node_id, [...incoming.get(edge.target_node_id) || [], edge]);
    outgoing.set(edge.source_node_id, [...outgoing.get(edge.source_node_id) || [], edge]);
  }
  const remaining = new Map(nodes.map(node => [node.node_id, incoming.get(node.node_id)?.length || 0]));
  const byId = new Map(nodes.map(node => [node.node_id, node]));
  const queue = nodes.filter(node => !remaining.get(node.node_id)).map(node => node.node_id);
  const positions: Positions = new Map();
  const occupied = new Set<string>();
  let nextLane = Math.max(-1, ...[...previous].filter(([id]) => ids.has(id)).map(([, pos]) => pos.y / 150)) + 1;
  const continuation = new Map<string, string>();
  for (const [id, links] of outgoing) {
    const sequences = links.filter(edge => edge.kind === 'sequence');
    const owner = byId.get(id)?.rollout_id;
    const first = sequences.find(edge => owner && byId.get(edge.target_node_id)?.rollout_id === owner) || sequences[0];
    if (first) continuation.set(id, first.target_node_id);
  }
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    const node = byId.get(id)!;
    const parents = incoming.get(id) || [];
    const depth = parents.length ? Math.max(...parents.map(edge => positions.get(edge.source_node_id)!.x / 300)) + 1 : 0;
    const preferred = parents.filter(edge => edge.kind === 'sequence' && byId.get(edge.source_node_id)?.kind !== 'query'
      && continuation.get(edge.source_node_id) === id)
      .sort((a, b) => positions.get(a.source_node_id)!.y - positions.get(b.source_node_id)!.y)[0];
    let lane = previous.get(id)?.y;
    if (lane == null) lane = node.kind === 'query' ? 0 : preferred ? positions.get(preferred.source_node_id)!.y : nextLane++ * 150;
    while (occupied.has(`${depth}:${lane}`)) lane = nextLane++ * 150;
    occupied.add(`${depth}:${lane}`);
    positions.set(id, { x: depth * 300, y: lane });
    for (const edge of outgoing.get(id) || []) {
      const count = remaining.get(edge.target_node_id)! - 1;
      remaining.set(edge.target_node_id, count);
      if (!count) queue.push(edge.target_node_id);
    }
  }
  return positions;
}

export function ancestorPath(selectedId: string | undefined, edges: TreeEdge[]) {
  const nodes = new Set<string>();
  const links = new Set<string>();
  const incoming = new Map<string, TreeEdge[]>();
  for (const edge of edges) incoming.set(edge.target_node_id, [...incoming.get(edge.target_node_id) || [], edge]);
  const stack = selectedId ? [selectedId] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (nodes.has(id)) continue;
    nodes.add(id);
    for (const edge of incoming.get(id) || []) {
      links.add(edgeId(edge));
      stack.push(edge.source_node_id);
    }
  }
  return { nodes, edges: links };
}
