import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseRoute, routeHash, workspaceRoute } from '../../app/navigation';
import { createTreeClient } from './api';
import { answerState, forestPositions, mergeDetail, rewardText } from './model';
import type { TreeDetail, TreeNode } from './types';

export const node = (id: string, extra: Partial<TreeNode> = {}): TreeNode => ({
  node_id: id, parent_id: 'query', kind: 'rollout', origin: 'initial',
  status: 'succeeded', store_status: 'succeeded', training_status: null,
  record_issues: [], attempt_id: 'attempt', attempt_sequence: 1, site_id: null,
  window_id: null, event_id: null, boundary_snapshot_ref: null,
  reward: null, verdict: null, execution_error: null, judgments: [], previous_attempts: [],
  decision: {}, metrics: {}, ...extra,
});
export const detail = (revision = 1, nodes = [node('a')]): TreeDetail => ({
  experiment_id: 'exp', run_id: 'abcdef123456', run_state: 'running',
  tree: { tree_id: 'a'.repeat(32), group_id: 'group', mode: 'train', revision,
    updated_at: null, query: 'Question', query_truncated: false, nodes, pending_nodes: [],
    outcomes: { a: { answer: 'Answer', reward: 0 } }, plans: [], issues: [] },
  page: { total: nodes.length, next_cursor: null, truncated: false, plan_total: 0, next_plan_offset: null },
});

afterEach(() => vi.unstubAllGlobals());
describe('sample result model', () => {
  it('round trips fixed run, selected answer and explicit view', () => {
    const route = { ...workspaceRoute('exp', 'records'), samples: {
      runId: 'abcdef123456', treeId: 'a'.repeat(32), nodeId: 'parent:child/1', view: 'branches' as const,
    } };
    expect(parseRoute(routeHash(route))).toEqual(route);
    expect(parseRoute('#/experiments/exp/runs/abcdef123456/samples')).toMatchObject({ samples: { view: 'answers' } });
    expect(parseRoute('#/experiments/exp/runs/invalid/samples').kind).toBe('not-found');
    expect(parseRoute('#/experiments/exp/runs/abcdef123456/samples?answer=x').kind).toBe('not-found');
    expect(parseRoute('#/experiments/exp/runs/abcdef123456/samples?view=unknown').kind).toBe('not-found');
  });
  it('keeps existing console routes unchanged', () => {
    const route = { ...workspaceRoute('exp'), console: 'training' as const, runId: 'abcdef123456' };
    expect(parseRoute(routeHash(route))).toEqual(route);
  });
  it('does not confuse zero, missing reward, failed execution or incomplete records', () => {
    expect(rewardText(0)).toBe('0');
    expect(rewardText(null)).toBe('—');
    expect(answerState(node('a'), { answer: 'A' }).label).toBe('执行已完成');
    expect(answerState(node('a', { terminal_unconfirmed: true })).label).toBe('结果待确认');
    expect(answerState(node('a', { status: 'failed' })).tone).toBe('danger');
    expect(answerState(node('a', { training_status: 'rejected' })).label).toContain('未接纳');
    expect(answerState(node('a')).label).toContain('答案未记录');
  });
  it('merges pages only within the same tree revision and keeps parent outcome', () => {
    const first = detail();
    const second = detail(1, [node('a'), node('child', { parent_id: 'a', origin: 'branch' })]);
    second.tree.outcomes = { child: { reward: 1 } };
    const merged = mergeDetail(first, second);
    expect(merged.tree.nodes).toHaveLength(2);
    expect(merged.tree.outcomes.a.reward).toBe(0);
    expect(merged.tree.outcomes.child.reward).toBe(1);
    expect(() => mergeDetail(first, detail(2))).toThrow();
  });
  it('lays out a forest without introducing a query execution node', () => {
    const nodes = [node('query', { kind: 'query', parent_id: null }), node('a'),
      node('b'), node('child', { parent_id: 'a', origin: 'branch' })];
    const positions = forestPositions(nodes);
    expect(positions.size).toBe(3);
    expect(positions.get('child')!.x).toBeGreaterThan(positions.get('a')!.x);
    expect(positions.get('b')!.x).toBe(positions.get('a')!.x);
    expect(forestPositions(nodes.map(n => ({ ...n, reward: 5 })))).toEqual(positions);
  });
});

describe('conditional tree reads', () => {
  it('reuses 304 responses and sends ETag', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(detail()), { headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetch);
    const client = createTreeClient('exp', 'abcdef123456');
    const signal = new AbortController().signal;
    const first = await client.detail('a'.repeat(32), signal);
    expect(await client.detail('a'.repeat(32), signal)).toBe(first);
    expect(fetch.mock.calls[1][1].headers).toEqual({ 'If-None-Match': '"v1"' });
  });
  it('rejects cross-run and stale-cursor responses explicitly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...detail(), run_id: 'other' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '树已更新' }), { status: 409 })));
    const client = createTreeClient('exp', 'abcdef123456');
    const signal = new AbortController().signal;
    await expect(client.detail('a'.repeat(32), signal)).rejects.toThrow('不属于当前训练');
    await expect(client.detail('a'.repeat(32), signal, '1:100')).rejects.toMatchObject({ status: 409 });
  });
});
