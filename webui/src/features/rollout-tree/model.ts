import type { Outcome, TreeDetail, TreeNode } from './types';

export const MAX_PAGES = 5;
export const terminalRun = (state?: string) => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state || '');
export const answerName = (id: string) => `回答 ${id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id}`;
export const rewardText = (value?: number | null) => value == null ? '—' : String(Number(value.toFixed(4)));
export function answerState(node: TreeNode, outcome?: Outcome) {
  if (node.terminal_unconfirmed) return { label: '结果待确认', tone: 'warning' };
  if (node.execution_error === 'timeout') return { label: '执行超时', tone: 'danger' };
  if (node.status === 'failed') return { label: '执行失败', tone: 'danger' };
  if (node.status === 'cancelled') return { label: '已取消', tone: 'neutral' };
  if (node.status === 'running') return { label: '执行中', tone: 'info' };
  if (node.status === 'enqueued') return { label: '等待执行', tone: 'neutral' };
  if (node.status === 'succeeded') {
    if (node.training_status === 'rejected') return { label: '执行已完成 · 训练样本未接纳', tone: 'warning' };
    return { label: outcome?.answer == null ? '执行已结束 · 答案未记录' : '执行已完成', tone: 'neutral' };
  }
  return { label: '状态未记录', tone: 'neutral' };
}
export function answerSource(node: TreeNode) {
  if (node.origin === 'initial') return '独立生成';
  if (node.origin === 'independent_fill') return '独立补采样';
  if (node.origin === 'branch' && node.parent_id) return `从${answerName(node.parent_id)}的中间位置重新生成`;
  return '生成来源未记录';
}
export function mergeDetail(first: TreeDetail, next: TreeDetail): TreeDetail {
  if (first.tree.tree_id !== next.tree.tree_id || first.tree.revision !== next.tree.revision) {
    throw new Error('不能合并不同题目或不同版本的记录。');
  }
  const merge = <T,>(a: T[], b: T[], key: (item: T) => string) => [...new Map([...a, ...b].map(item => [key(item), item])).values()];
  return {
    ...next,
    tree: { ...next.tree,
      nodes: merge(first.tree.nodes, next.tree.nodes, n => n.node_id),
      pending_nodes: merge(first.tree.pending_nodes, next.tree.pending_nodes, n => n.node_id),
      plans: merge(first.tree.plans, next.tree.plans, p => p.plan_id),
      outcomes: { ...first.tree.outcomes, ...next.tree.outcomes },
    },
  };
}

// Parent-before-child preorder gives compact, deterministic forest layout.
export function forestPositions(nodes: Pick<TreeNode, 'node_id' | 'parent_id' | 'kind'>[]) {
  const actual = nodes.filter(node => node.kind !== 'query');
  const ids = new Set(actual.map(node => node.node_id));
  const children = new Map<string, typeof actual>();
  for (const node of actual) {
    const parent = node.parent_id && ids.has(node.parent_id) ? node.parent_id : '';
    const siblings = children.get(parent) || [];
    siblings.push(node); children.set(parent, siblings);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const stack = [...(children.get('') || [])].reverse().map(node => ({ node, depth: 0 }));
  while (stack.length) {
    const entry = stack.pop()!;
    if (positions.has(entry.node.node_id)) continue;
    positions.set(entry.node.node_id, { x: entry.depth * 310, y: positions.size * 115 });
    for (const child of [...(children.get(entry.node.node_id) || [])].reverse()) stack.push({ node: child, depth: entry.depth + 1 });
  }
  return positions;
}
