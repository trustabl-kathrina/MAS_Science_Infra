import { memo } from 'react';
import { ChevronDown, History, ListTree, RefreshCw, Terminal } from 'lucide-react';
import type { RunDetail } from '../../shared/api/types';
import { Button } from '../../shared/ui/button';
import { Snapshot, TRAIN_STATE } from '../training/components/TrainingConsole';

export const SampleHeader = memo(function SampleHeader({ experimentId, runId, run, runState, updatedAt, onHistory, onLog, onRefresh }: {
  experimentId: string; runId: string; run: RunDetail | null; runState?: string; updatedAt?: string | null;
  onHistory: () => void; onLog: () => void; onRefresh: () => void;
}) {
  const status = run?.state || runState || '';
  const tone = status === 'failed' ? 'danger' : status === 'running' ? 'info' : 'neutral';
  return <header className="sample-page-header">
    <div className="sample-header-identity">
      <span className="sample-header-icon"><ListTree size={21} aria-hidden="true" /></span>
      <div className="sample-header-copy">
        <div className="sample-header-title"><h1>采样结果</h1>
          {run?.meta?.algo != null && <span className="sample-algorithm">{String(run.meta.algo).toUpperCase()}</span>}
          <span className={`sample-run-state is-${tone}`}><i aria-hidden="true" />{TRAIN_STATE[status] || '读取状态…'}</span>
        </div>
        <div className="sample-header-meta">
          <span>{run?.started_at ? new Date(run.started_at * 1000).toLocaleString() : '启动时间未记录'}</span>
          <details className="sample-run-info"><summary><code>{runId}</code><ChevronDown size={11} aria-hidden="true" /></summary>
            <dl><dt>训练运行</dt><dd>{runId}</dd><dt>实验</dt><dd>{experimentId}</dd>
              <dt>所选题目记录更新</dt><dd>{updatedAt ? new Date(updatedAt).toLocaleString() : '尚未读取'}</dd></dl>
          </details>
        </div>
      </div>
    </div>
    <div className="sample-actions">
      <Button size="sm" variant="ghost" onClick={onHistory}><History size={14} />训练记录</Button>
      <Button size="sm" onClick={onLog}><Terminal size={14} />查看日志</Button>
      <Snapshot experimentId={experimentId} runId={runId} />
      <Button size="sm" variant="ghost" aria-label="刷新采样结果" title="刷新采样结果" onClick={onRefresh}><RefreshCw size={15} /></Button>
    </div>
  </header>;
});
