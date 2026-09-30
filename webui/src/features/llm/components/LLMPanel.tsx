import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import type { Bundle, HealthResponse, LlmOption, LlmOptionsResponse } from '../../../shared/api/types';
import { errorMessage } from '../../../shared/api/http';
import { ActionBar } from '../../../shared/components/ActionBar';
import { FormField } from '../../../shared/components/FormField';
import { InlineNotice } from '../../../shared/components/InlineNotice';
import { JsonDetails } from '../../../shared/components/JsonDetails';
import { LoadingState } from '../../../shared/components/LoadingState';
import { PageHeader } from '../../../shared/components/PageHeader';
import { Section } from '../../../shared/components/Section';
import { StatusBadge } from '../../../shared/components/StatusBadge';
import { useAction } from '../../../shared/hooks/useAction';
import { useUnsavedChanges } from '../../../shared/hooks/useUnsavedChanges';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';

type Props = {
  expId: string; bundle: Bundle | null; onReload: () => void;
  embedded?: boolean; view?: 'connection' | 'environment'; onConfigureModel?: () => void;
};

const probeLabels: Record<HealthResponse['status'], string> = {
  reachable: '模型列表可访问',
  authentication_failed: '鉴权或权限失败',
  rate_limited: '请求限流',
  unsupported: '不支持模型列表探测',
  network_error: '网络连接失败',
  timeout: '请求超时',
  server_error: '服务端错误',
  invalid_response: '模型列表响应无效',
  configuration_error: '配置不完整或不支持',
  request_failed: '探测请求失败',
};

interface ProbeSnapshot {
  kind: string;
  model: string;
  baseUrl: string;
  inputRevision: number;
  configRevision: string | undefined;
}

function optionLabel(item: LlmOption) {
  const bits = [item.name];
  if (item.served) bits.push('正在服务');
  if (item.model_type) bits.push(item.model_type);
  return bits.join(' · ');
}

export function LLMPanel(props: Props) {
  if (!props.bundle || props.bundle.id !== props.expId) return <LoadingState label="加载 llm.yaml…" />;
  return <LlmSettings key={props.expId} {...props} bundle={props.bundle} />;
}

function LlmSettings({ expId, bundle, onReload, embedded = false, view = 'connection', onConfigureModel }: Props & { bundle: Bundle }) {
  const [kind, setKind] = useState(String(bundle.llm.kind || 'api'));
  const [model, setModel] = useState(String(bundle.llm.model || ''));
  const [baseUrl, setBaseUrl] = useState(String(bundle.llm.base_url || ''));
  const [modelPath, setModelPath] = useState(String(bundle.llm.model_path || ''));
  const [port, setPort] = useState(Number(bundle.llm.port || 8000));
  const [gpuMem, setGpuMem] = useState(Number(bundle.llm.gpu_memory_utilization || 0.45));
  const [apiKey, setApiKey] = useState('');
  const [probe, setProbe] = useState<{ result: HealthResponse; snapshot: ProbeSnapshot } | null>(null);
  const [options, setOptions] = useState<LlmOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const inputRevision = useRef(0);
  const keyRevision = useRef(0);
  const editRevision = useRef(0);
  const settings = { kind, model, base_url: baseUrl, model_path: modelPath, port, gpu_memory_utilization: gpuMem };
  const [savedSettings, setSavedSettings] = useState(() => JSON.stringify(settings));
  const dirty = JSON.stringify(settings) !== savedSettings || apiKey !== '';
  const health = probe?.result;
  const probeStale = Boolean(probe && (probe.snapshot.inputRevision !== inputRevision.current
    || probe.snapshot.kind !== kind || probe.snapshot.model !== model || probe.snapshot.baseUrl !== baseUrl
    || probe.snapshot.configRevision !== bundle.llm.config_revision));
  const { pending, run } = useAction();
  const stopAction = useAction();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (kind === 'rl_endpoint') {
      setOptions(null);
      setOptionsError(null);
      setOptionsLoading(false);
      return;
    }
    if (kind === 'api' && !baseUrl.trim()) {
      setOptions({ kind: 'api', items: [], message: '请先填写 API 端点，再加载可调用模型列表。' });
      setOptionsError(null);
      setOptionsLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setOptionsLoading(true);
        setOptionsError(null);
        try {
          const data = await api.llmOptions(expId, {
            kind,
            ...(kind === 'api' ? { base_url: baseUrl, api_key: apiKey || undefined } : { port }),
          }, controller.signal);
          if (!mounted.current || controller.signal.aborted) return;
          setOptions(data);
          if (data.probe) {
            setProbe({
              result: data.probe,
              snapshot: { kind, model, baseUrl, inputRevision: inputRevision.current, configRevision: bundle.llm.config_revision },
            });
          }
        } catch (error) {
          if (!mounted.current || controller.signal.aborted) return;
          setOptionsError(errorMessage(error));
        } finally {
          if (mounted.current && !controller.signal.aborted) setOptionsLoading(false);
        }
      })();
    }, kind === 'api' ? 450 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [kind, baseUrl, apiKey, port, expId, bundle.llm.config_revision]);

  const persist = async (override?: typeof settings) => {
    const submittedKeyRevision = keyRevision.current;
    const payload = override || settings;
    const submitted = {
      ...payload, ...(apiKey ? { api_key: apiKey } : {}),
    };
    await api.putSection(expId, 'llm', submitted);
    if (mounted.current) {
      setSavedSettings(JSON.stringify(payload));
      if (keyRevision.current === submittedKeyRevision && apiKey) {
        inputRevision.current += 1;
        keyRevision.current += 1;
        setApiKey('');
      }
      await onReload();
    }
  };

  const save = async () => {
    const submittedRevision = editRevision.current;
    const success = await run('save', async () => { await persist(); return '已保存 llm.yaml。本地模型请从列表中选择以启动 vLLM。'; });
    return success && mounted.current && editRevision.current === submittedRevision;
  };

  useUnsavedChanges('llm-settings', {
    label: 'LLM 配置', resource: 'llm',
    dirty,
    busy: pending !== null || stopAction.pending !== null, save,
  });

  const items = options?.items || [];
  const selectedLocal = items.find(item => item.path === modelPath || item.id === modelPath);
  const selectedApi = items.find(item => item.id === model || item.name === model);
  const listed = kind === 'local' ? Boolean(selectedLocal) : Boolean(selectedApi);
  const selectValue = kind === 'local'
    ? ((selectedLocal?.served || pending === 'start') ? (selectedLocal?.id || modelPath || '') : '')
    : (selectedApi?.id || model || '');

  const pickModel = (value: string) => {
    editRevision.current += 1;
    inputRevision.current += 1;
    if (kind === 'local') {
      const item = items.find(entry => entry.id === value || entry.path === value);
      if (!item) return;
      const next = {
        kind: 'local',
        model: item.name,
        base_url: `http://127.0.0.1:${port || 8000}/v1`,
        model_path: item.path || item.id,
        port,
        gpu_memory_utilization: gpuMem,
      };
      setModel(next.model);
      setModelPath(next.model_path);
      setBaseUrl(next.base_url);
      void run('start', async () => {
        await persist(next);
        if (!mounted.current) return;
        const result = await api.llmStart(expId);
        if (mounted.current) {
          const data = await api.llmOptions(expId, { kind: 'local', port: next.port });
          setOptions(data);
          await onReload();
        }
        return result.reused
          ? `已在服务 ${next.model} → ${result.base_url}`
          : `已选择 ${next.model}，正在启动本地 vLLM → ${result.base_url}`;
      });
      return;
    }
    setModel(value);
  };

  const changeKind = (next: string) => {
    const previous = kind;
    editRevision.current += 1;
    inputRevision.current += 1;
    setKind(next);
    if (next === 'local' && (!baseUrl || (!baseUrl.includes('127.0.0.1') && !baseUrl.includes('localhost')))) {
      setBaseUrl(`http://127.0.0.1:${port || 8000}/v1`);
    }
    if (previous === 'local' && next !== 'local') {
      void api.llmStop(expId).then(() => { if (mounted.current) void onReload(); });
    }
  };

  return <div className={`page-stack ${embedded ? 'settings-embedded' : 'settings-page'}`}>
    {!embedded && <PageHeader title="LLM" eyebrow="模型连接" description="选择 API 或本地 LLM，从可调用列表中指定模型，再去 MAS 运行 Workflow。" />}
    <div hidden={view === 'environment'}>
    <Section title={embedded ? '默认推理模型' : '连接配置'} actions={<StatusBadge tone={dirty ? 'warning' : 'neutral'}>
      {pending === 'save' ? '保存中' : dirty ? '未保存' : '已保存配置'}
    </StatusBadge>}>
      {embedded && <p className="field-hint">所有 Agent 继承此连接。选择本地模型时才会启动 vLLM；未选择时 GPU 上不常驻模型。</p>}
      <FormField label="模式">
        <Select value={kind} onChange={(event) => changeKind(event.target.value)}>
          <option value="api">API（第三方 OpenAI-compat）</option>
          <option value="local">Local（仓库 LLM/ 目录 + 本地 vLLM）</option>
          <option value="rl_endpoint">RL endpoint（训练时由 AGL 注入）</option>
        </Select>
      </FormField>
      {kind === 'api' && <p className="field-hint">填写端点后自动读取 /v1/models，从列表里选择实际调用的模型。远程 API 不占用本机显卡。</p>}
      {kind === 'local' && <InlineNotice tone="info">本地列表来自仓库 LLM/ 目录（磁盘权重）。从列表中选择某个模型后才会启动 vLLM 并占用 GPU；切换到 API 会停止本地服务。</InlineNotice>}
      {kind === 'rl_endpoint' && <InlineNotice tone="warning">此模式由训练过程注入。独立真实运行请选择 API 或本地服务；示例模拟执行不受影响。</InlineNotice>}
      {kind !== 'rl_endpoint' && <FormField label={kind === 'local' ? '本地可调用模型' : 'API 可调用模型'}
        hint={kind === 'local'
          ? `扫描 ${options?.local_root || 'LLM/'}。选择一项即保存并启动 vLLM。`
          : '来自当前端点的 /v1/models；列表为空时请先填写端点或检查密钥。'}>
        <Select value={selectValue} disabled={optionsLoading || kind === 'rl_endpoint' || pending === 'start'}
          onChange={(event) => pickModel(event.target.value)}>
          <option value="">{optionsLoading ? '正在加载模型列表…' : kind === 'local' ? '请选择本地模型（选择后启动 vLLM）' : '请选择要调用的模型'}</option>
          {kind === 'api' && model && !listed &&
            <option value={model}>{model} · 当前配置</option>}
          {items.map(item => <option key={item.id} value={item.id}>{optionLabel(item)}</option>)}
        </Select>
      </FormField>}
      {optionsError && <InlineNotice tone="danger">无法加载模型列表：{optionsError}</InlineNotice>}
      {!optionsError && options?.message && items.length === 0 && kind !== 'rl_endpoint' &&
        <InlineNotice tone="warning">{options.message}</InlineNotice>}
      {kind === 'local' && options?.serving?.models?.length ? <p className="field-hint">
        当前本地服务 {options.serving.base_url} 已加载：{options.serving.models.join('、')}
      </p> : null}
      <div className="form-grid">
        {kind === 'api' && <FormField label="model"><Input value={model} onChange={(event) => { editRevision.current += 1; inputRevision.current += 1; setModel(event.target.value); }} /></FormField>}
        <FormField label="base_url"><Input value={baseUrl} onChange={(event) => { editRevision.current += 1; inputRevision.current += 1; setBaseUrl(event.target.value); }} /></FormField>
      </div>
      {kind !== 'rl_endpoint' && <div className="grid gap-2">
        <FormField label="API Key" hint="写入实验 .secrets.env，不会回显。留空保留已有密钥；保存后仅清空未再次编辑的输入。本地无鉴权服务可留空。">
          <Input type="password" autoComplete="off" placeholder={bundle.llm.api_key_set ? '••••（已配置）' : '可选：无鉴权服务可留空'} value={apiKey}
            onChange={(event) => { editRevision.current += 1; inputRevision.current += 1; keyRevision.current += 1; setApiKey(event.target.value); }} />
        </FormField>
        <div><StatusBadge tone={bundle.llm.api_key_set ? 'success' : 'neutral'}>
          {bundle.llm.credential_source === 'experiment' ? '使用实验密钥'
            : bundle.llm.credential_source === 'service' ? '使用服务默认密钥'
              : bundle.llm.api_key_set ? '密钥已配置' : '未提供密钥'}
        </StatusBadge></div>
      </div>}
      {kind === 'local' && <div className="form-grid">
        <FormField label="model_path"><Input value={modelPath} onChange={(event) => { editRevision.current += 1; setModelPath(event.target.value); }} /></FormField>
        <FormField label="port"><Input type="number" value={port} onChange={(event) => { editRevision.current += 1; setPort(Number(event.target.value)); }} /></FormField>
        <FormField label="gpu_memory_utilization"><Input type="number" step="0.05" value={gpuMem} onChange={(event) => { editRevision.current += 1; setGpuMem(Number(event.target.value)); }} /></FormField>
      </div>}
      <ActionBar>
        <Button variant="primary" loading={pending === 'save'} disabled={pending !== null} onClick={() => { void save(); }}>保存模型配置</Button>
        <Button loading={pending === 'health'} disabled={pending !== null || kind === 'rl_endpoint'} onClick={() => {
          void run('health', async () => {
            const data = await api.llmOptions(expId, {
              kind, base_url: baseUrl, api_key: apiKey || undefined, port,
            });
            if (mounted.current) {
              setOptions(data);
              if (data.probe) {
                setProbe({
                  result: data.probe,
                  snapshot: { kind, model, baseUrl, inputRevision: inputRevision.current, configRevision: bundle.llm.config_revision },
                });
              }
            }
            return data.items.length ? `已列出 ${data.items.length} 个可调用模型` : (data.message || '模型列表为空');
          });
        }}>{kind === 'local' ? '刷新本地列表' : '加载 API 模型列表'}</Button>
      </ActionBar>
      <p className="field-hint">API 模式选择模型后请保存。本地模式在下拉框中选择即启动 vLLM，不预先占用 GPU。</p>
    </Section>
    </div>
    {(view === 'environment' || !embedded) && kind === 'local' && <Section title="本地模型服务" description="选择本地模型时自动启动 vLLM。此处可重试启动或手动停止以释放 GPU。">
      <p className="field-hint">模型：{model || '未选择'} · 路径：{modelPath || '未选择'} · 端口：{port}{pending === 'start' ? ' · 正在启动 vLLM' : ''}</p>
      <ActionBar>
        <Button loading={pending === 'start'} disabled={pending !== null || !modelPath} onClick={() => {
          void run('start', async () => {
            await persist();
            if (!mounted.current) return;
            const result = await api.llmStart(expId);
            if (mounted.current) onReload();
            return result.reused
              ? `已在服务 ${model} → ${result.base_url}`
              : `正在启动本地 vLLM run=${result.run_id} → ${result.base_url}`;
          });
        }}>重新启动 vLLM</Button>
        <Button variant="danger" loading={stopAction.pending !== null} onClick={() => {
          void stopAction.run('stop', async () => { await api.llmStop(expId); return 'LLM stopped'; });
        }}>停止 LLM</Button>
      </ActionBar>
    </Section>}
    {view === 'environment' && kind !== 'local' && <Section title="推理环境">
      <p className="field-hint">{kind === 'api' ? '当前使用远程 API 推理，无需本机 GPU 或训练进程。'
        : '当前模型端点由训练过程注入，独立调试请选择 API 或已启动的本地模型服务。'}</p>
      {onConfigureModel && <Button size="sm" onClick={onConfigureModel}>前往模型绑定</Button>}
    </Section>}
    <div hidden={view === 'environment'}>
    <Section title="连接探测结果" actions={<StatusBadge tone={!health ? 'neutral' : probeStale || health.status === 'unsupported' ? 'warning' : health.ok ? 'success' : 'danger'}>
      {!health ? '尚未探测' : probeStale ? '探测结果已过期' : probeLabels[health.status]}
    </StatusBadge>}>
      {!health ? <p className="field-hint">本地列表来自磁盘扫描；API 列表来自端点探测。尚未探测不代表失败。</p> : <>
        {probeStale && <InlineNotice tone="warning">输入或已保存配置已变化，以下结果不代表当前配置；请按需重新探测。</InlineNotice>}
        <InlineNotice tone={probeStale || health.status === 'unsupported' ? 'warning' : health.ok ? 'success' : 'danger'}>
          {probeLabels[health.status]}：{health.message}
        </InlineNotice>
        <p className="field-hint">探测时间：{new Date(health.checked_at).toLocaleString()} · 仅模型列表；实际推理与工具调用均未验证。</p>
        <JsonDetails value={{
          status: health.status, status_code: health.status_code, models: health.models,
          url: health.url, checked_at: health.checked_at, probe_type: health.probe_type,
          inference_verified: health.inference_verified, tool_calling_verified: health.tool_calling_verified,
        }} label="查看探测详情（不含密钥）" />
      </>}
    </Section>
    </div>
  </div>;
}
