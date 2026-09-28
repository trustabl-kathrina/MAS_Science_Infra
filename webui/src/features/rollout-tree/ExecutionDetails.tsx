import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { Button } from '../../shared/ui/button';
import { executionName } from './model';
import type { ExecutionDetail, JSONValue, TreeNode } from './types';

const labels: Record<string, string> = {
  role: '角色', content: '内容', name: '名称', function: '工具', arguments: '参数',
  result: '结果', type: '类型', tool_call_id: '调用 ID', text: '文本',
};

function SavedContent({ value }: { value: JSONValue }) {
  if (value === null) return <span className="field-hint">未记录</span>;
  if (Array.isArray(value)) return <div className="sample-saved-items">{value.map((item, index) =>
    <div key={index}><SavedContent value={item} /></div>)}</div>;
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, item]) =>
    <div key={key}><dt>{labels[key] || key}</dt><dd><SavedContent value={item} /></dd></div>)}</dl>;
  return <pre className="sample-saved-text">{String(value)}</pre>;
}

export function ExecutionDetails({ node, detail, query, loading, error, onRetry, onClose }: {
  node: TreeNode; detail?: ExecutionDetail | null; query: string; loading: boolean;
  error?: string | null; onRetry: () => void; onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLElement>(null);
  const title = node.kind === 'query' ? '问题' : executionName(node);
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  return <aside ref={root} tabIndex={-1} aria-label={`${title}详情`}
    className={`sample-details${expanded ? ' is-expanded' : ''}`} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    }}>
    <header><h3>{title}</h3>
      <Button size="sm" variant="ghost" aria-label={expanded ? '恢复详情宽度' : '展开阅读'} onClick={() => setExpanded(value => !value)}>
        {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</Button>
      <Button size="sm" variant="ghost" aria-label="关闭节点详情" onClick={onClose}><X size={16} /></Button>
    </header>
    <div className="sample-details-scroll">
      {error && <p role="alert" className="sample-warning">节点内容读取失败：{error}。已加载内容可能陈旧。
        <Button size="sm" onClick={onRetry}>重试节点读取</Button></p>}
      {node.kind === 'query' ? <p className="sample-full-answer">{query}</p> : <>
        <p>{({ succeeded: '执行已完成', failed: '执行失败', running: '执行中', enqueued: '等待执行', cancelled: '已取消' })[detail?.status || node.status || ''] || '状态未记录'}
          {detail?.elapsed_seconds != null && ` · ${detail.elapsed_seconds} 秒`}{detail?.model && ` · ${detail.model}`}</p>
        {loading && !detail && <p>正在读取实际执行内容…</p>}
        {!loading && !detail && !error && <p className="field-hint">执行正文尚未记录；运行期间会继续更新。</p>}
        {detail?.content_truncated && <p className="sample-warning">保存内容已截断，以下不是完整执行正文。</p>}
        {detail?.input_changed && <p className="field-hint">本次输入经过上下文处理，以下为实际保存的输入。</p>}
        {detail && <>
          <section><h4>输出与推理</h4>
            {detail.reasoning != null && detail.reasoning !== '' ? <><h4>模型返回的 reasoning</h4><SavedContent value={detail.reasoning} /></>
              : <p className="field-hint">未记录独立 reasoning，不补造推理内容。</p>}
            <h4>普通输出</h4>{detail.output != null ? <SavedContent value={detail.output} /> : <p>输出尚未记录</p>}
          </section>
          <details><summary>输入 · 实际保存内容</summary>
            {detail.input != null ? <SavedContent value={detail.input} /> : <p>输入尚未记录</p>}
          </details>
          {detail.tool_calls != null && <section><h4>工具调用与参数</h4><SavedContent value={detail.tool_calls} /></section>}
          {detail.observation != null && <section><h4>工具结果 / 观察</h4><SavedContent value={detail.observation} /></section>}
          {!!detail.errors?.length && <section aria-label="执行错误"><h4>执行错误</h4>
            {detail.errors.map((error, index) => <p className="sample-full-answer sample-warning" key={index}>{error}</p>)}</section>}
        </>}
      </>}
      <details><summary>技术信息</summary>
        <dl>{Object.entries({ 'Node ID': node.node_id, 'Rollout ID': node.rollout_id,
          Attempt: node.attempt_id, '详情引用': node.detail_ref, '快照引用': node.boundary_snapshot_ref,
          '输出来源': detail?.output_origin,
        }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '未记录'}</dd></div>)}</dl>
        {node.record_issues.map(issue => <p key={issue} className="sample-warning">{issue}</p>)}
        {(Object.keys(node.decision || {}).length > 0 || Object.keys(node.metrics || {}).length > 0) &&
          <><h4>已有门控与指标</h4><pre>{JSON.stringify({ decision: node.decision, metrics: node.metrics }, null, 2)}</pre></>}
      </details>
    </div>
  </aside>;
}
