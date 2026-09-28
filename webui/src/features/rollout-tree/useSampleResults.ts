import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../shared/api/http';
import { usePollingResource } from '../../shared/hooks/usePollingResource';
import { runtimeApi } from '../runtime/api';
import { createTreeClient } from './api';
import { MAX_PAGES, mergeDetail, terminalRun } from './model';
import type { TreeDetail } from './types';

function useVisible(active: boolean) {
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return active && visible;
}

export function useSampleResults(experimentId: string, runId: string, treeId: string | undefined,
  nodeId: string | undefined, active: boolean) {
  const enabled = useVisible(active);
  const client = useMemo(() => createTreeClient(experimentId, runId), [experimentId, runId]);
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState('');
  const [settled, setSettled] = useState(false);
  const [extent, setExtent] = useState<{ treeId?: string; pages: number; planPages: number; cursor?: string }>({ treeId, pages: 1, planPages: 1 });
  const cursor = extent.treeId === treeId ? extent.cursor : undefined;
  const pages = extent.treeId === treeId ? extent.pages : 1;
  const planPages = extent.treeId === treeId ? extent.planPages : 1;
  const interval = settled ? undefined : 3000;
  const runLoad = useCallback((signal: AbortSignal) => runtimeApi.trainingRun(experimentId, runId, signal), [experimentId, runId]);
  const run = usePollingResource(`sample-run:${experimentId}:${runId}`, runLoad, interval, enabled);
  useEffect(() => {
    if (!terminalRun(run.data?.state)) { setSettled(false); return; }
    if (!enabled) return;
    const timer = setTimeout(() => setSettled(true), 6500);
    return () => clearTimeout(timer);
  }, [run.data?.state, enabled]);
  const listLoad = useCallback((signal: AbortSignal) => client.list(offset, mode, signal), [client, offset, mode]);
  const list = usePollingResource(`sample-list:${experimentId}:${runId}:${offset}:${mode}`, listLoad, interval, enabled);

  const assembled = useRef<{ key: string; revision: number; data: TreeDetail }>();
  const detailLoad = useCallback(async (signal: AbortSignal): Promise<TreeDetail> => {
    if (!treeId) throw new Error('请先选择题目。');
    // Restart once on a changing cursor; do not mix revisions or retry forever.
    for (let attempt = 0; ; attempt++) {
      try {
        let detail = await client.detail(treeId, signal, cursor);
        const key = JSON.stringify([experimentId, runId, treeId, cursor, pages, planPages, nodeId]);
        if (assembled.current?.key === key && assembled.current.revision === detail.tree.revision
          && assembled.current.data.run_state === detail.run_state) return assembled.current.data;
        for (let page = 1; page < MAX_PAGES; page++) {
          const wanted = nodeId && ![...detail.tree.nodes, ...detail.tree.pending_nodes].some(n => n.node_id === nodeId);
          const moreNodes = (page < pages || wanted) && detail.page.next_cursor;
          const morePlans = page < planPages && detail.page.next_plan_offset !== null;
          if (!moreNodes && !morePlans) break;
          const next = await client.detail(treeId, signal, moreNodes || undefined,
            morePlans ? detail.page.next_plan_offset! : 0);
          const previousPage = detail.page;
          detail = mergeDetail(detail, next);
          if (!moreNodes) detail.page = { ...detail.page, next_cursor: previousPage.next_cursor, truncated: previousPage.truncated };
          if (!morePlans) detail.page = { ...detail.page, next_plan_offset: previousPage.next_plan_offset };
        }
        detail = { ...detail, lookup_node_id: nodeId };
        if (!signal.aborted) assembled.current = { key, revision: detail.tree.revision, data: detail };
        return detail;
      } catch (error) {
        if (!cursor && attempt === 0 && error instanceof ApiError && error.status === 409) continue;
        throw error;
      }
    }
  }, [client, experimentId, runId, treeId, nodeId, pages, planPages, cursor]);
  const detail = usePollingResource(`sample-tree:${experimentId}:${runId}:${treeId || ''}:${cursor || ''}`, detailLoad, interval, enabled && !!treeId);
  useEffect(() => { if (treeId && enabled) void detail.refresh(); }, [treeId, nodeId, pages, planPages, enabled, detail.refresh]);
  const loadMore = useCallback((plans = false) => setExtent({
    treeId, pages: Math.min(MAX_PAGES, pages + (plans ? 0 : 1)),
    planPages: Math.min(MAX_PAGES, planPages + (plans ? 1 : 0)), cursor,
  }), [treeId, pages, planPages, cursor]);
  const nextWindow = useCallback(() => {
    if (detail.data?.page.next_cursor) setExtent({
      treeId, pages: 1, planPages: 1, cursor: detail.data.page.next_cursor,
    });
  }, [treeId, detail.data?.page.next_cursor]);
  const resetWindow = useCallback(() => {
    assembled.current = undefined;
    setExtent({ treeId, pages: 1, planPages: 1 });
    void detail.refresh();
  }, [treeId, detail.refresh]);
  const filter = useCallback((next: string) => { setMode(next); setOffset(0); }, []);
  const refresh = useCallback(() => { void run.refresh(); void list.refresh(); if (treeId) void detail.refresh(); },
    [run.refresh, list.refresh, detail.refresh, treeId]);
  return { run, list, detail, enabled, offset, setOffset, mode, filter, refresh, loadMore,
    pages, planPages, cursor, nextWindow, resetWindow };
}
