import { memo, useEffect, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { datasetResourcesApi, type DatasetResource } from '../../resources/api';
import { masApi, type EvalSources } from '../api';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { InlineNotice } from '../../../shared/components/InlineNotice';

export const EvalDialog = memo(function EvalDialog({ experimentId, open, onOpenChange, onStarted }: {
  experimentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (runId: string) => void;
}) {
  const [sources, setSources] = useState<EvalSources | null>(null);
  const [items, setItems] = useState<DatasetResource[]>([]);
  const [sourceError, setSourceError] = useState('');
  const [path, setPath] = useState('');
  const [limit, setLimit] = useState(20);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSourceError('');
    setError('');
    setPath('');
    void Promise.all([
      masApi.evalSources(experimentId, controller.signal),
      datasetResourcesApi.list(controller.signal),
    ]).then(([nextSources, catalog]) => {
      if (controller.signal.aborted) return;
      setSources(nextSources);
      setItems(catalog.items);
      const usable = catalog.items.filter((item) => item.exists !== false);
      const preferred = usable.find((item) => item.path === nextSources.val_files);
      setPath((preferred || usable[0])?.path || '');
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setSourceError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => controller.abort();
  }, [experimentId, open]);

  const selected = items.find((item) => item.path === path);
  const selectedMissing = Boolean(selected && selected.exists === false);

  const run = async () => {
    setPending(true);
    setError('');
    try {
      const readiness = await masApi.readiness(experimentId);
      if (!readiness.ready) {
        setError(readiness.blocking_issues.map((issue) => issue.message).join('；') || '模型尚未就绪，不能开始测试。');
        return;
      }
      const started = await masApi.evalRun(experimentId, { path, limit: Math.max(1, Math.min(limit || 20, 200)) });
      onStarted(started.run_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };

  return <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="dialog-overlay" />
      <AlertDialog.Content className="dialog-content eval-dialog">
        <AlertDialog.Title className="dialog-title">测试 MAS</AlertDialog.Title>
        <AlertDialog.Description className="dialog-description">
          从模型与数据中选择一份数据集执行工作流。进度和每条结果写在控制台，不会启动训练。
        </AlertDialog.Description>
        {sourceError && <InlineNotice tone="danger">{sourceError}</InlineNotice>}
        <label className="eval-split">数据集
          <Select aria-label="选择测试数据集" value={path} onChange={(event) => setPath(event.target.value)}>
            {!path && <option value="">选择数据集</option>}
            {items.map((item) => <option key={item.id} value={item.path} disabled={item.exists === false}>
              {item.name}{item.exists === false ? '（文件不存在）' : ''}
            </option>)}
          </Select>
          {selected && <span className="field-hint">{selected.path}</span>}
          {sources?.val_files && path === sources.val_files && <span className="field-hint">当前实验的验证集</span>}
        </label>
        <label className="eval-limit">本次条数
          <Input type="number" min={1} max={200} value={String(limit)} aria-label="本次测试条数"
            onChange={(event) => setLimit(Number(event.target.value) || 20)} />
        </label>
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        <div className="dialog-actions">
          <AlertDialog.Cancel asChild><Button disabled={pending}>关闭</Button></AlertDialog.Cancel>
          <Button variant="primary" loading={pending}
            disabled={pending || !path || selectedMissing || !items.length}
            onClick={() => void run()}>开始测试</Button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
});
