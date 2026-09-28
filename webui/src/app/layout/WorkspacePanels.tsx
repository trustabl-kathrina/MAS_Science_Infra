import { lazy, memo, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Bundle, MetaResponse } from '../../shared/api/types';
import { ExperimentPanel } from '../../pages/Experiment';
import { MASPanel } from '../../pages/MAS';
import { MonitorPanel } from '../../pages/Monitor';
import { useAgl, useMonitor, useTraining } from '../providers/RuntimeProvider';
import { isCanvasPanel, type PanelId, type ResourceCategory, type SampleSelection } from '../navigation';
import type { SettingsSection } from '../../features/settings/model/sections';
import { RunConsole } from '../../features/mas/components/RunConsole';
import { TrainingHistory } from '../../features/training/components/TrainingHistory';

const Experiment = memo(ExperimentPanel);
const Mas = memo(MASPanel);
const SampleResults = lazy(() => import('../../features/rollout-tree/SampleResults').then(module => ({ default: module.SampleResults })));

function RetainedPanel({ active, id, label, children }: {
  active: boolean; id: PanelId; label: string; children: ReactNode;
}) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  return <div id={`panel-${id}`} hidden={!active} role="region" aria-label={`${label} 面板`}>
    {(active || visited) && children}
  </div>;
}

const MonitorConnection = memo(function MonitorConnection({ expId, visible }: { expId: string; visible: boolean }) {
  const { data, refresh } = useTraining();
  const agl = useAgl();
  const monitor = useMonitor();
  return <MonitorPanel expId={expId} visible={visible}
    model={monitor.data} error={monitor.error} loading={monitor.loading} onRefresh={monitor.refresh}
    trainRunId={data?.runId ?? null} trainRunning={data?.running ?? false} trainLog={data?.log ?? ''}
    aglOnline={!!agl.data?.ok && !agl.error} onRefreshLog={refresh} />;
});

export const WorkspacePanels = memo(function WorkspacePanels({ active, visible, bundle, meta, onReload, setExpId, onWorkspace, settings, onResources, onSettings, selectedResource, resourcePurpose, consoleRun, trainingConsole, samples, onSamples, onChangePanel }: {
  active: PanelId; visible: boolean; bundle: Bundle; meta: MetaResponse | null; onReload: () => Promise<void>; setExpId: (id: string) => void;
  onWorkspace: () => void;
  settings?: SettingsSection; onResources: (category: ResourceCategory) => void;
  onSettings: (section: SettingsSection) => void;
  selectedResource?: string;
  resourcePurpose?: 'inference' | 'training';
  consoleRun?: string;
  trainingConsole?: boolean;
  samples?: SampleSelection;
  onSamples: (selection: SampleSelection) => void;
  onChangePanel: (id: PanelId) => void;
}) {
  const common = { expId: bundle.id, bundle, onReload };
  const canvas = isCanvasPanel(active);
  const requestedSettings = settings || (active === 'llm' ? 'inference' : active === 'rl' ? 'training' : active === 'harness' ? 'diagnostics' : null);
  const [jump, setJump] = useState(0);
  const openSamples = useCallback((runId: string) => onSamples({ runId, view: 'answers' }), [onSamples]);
  const backToRecords = useCallback(() => onChangePanel('records'), [onChangePanel]);
  const configure = useCallback((section: SettingsSection) => {
    setJump(value => value + 1);
    onSettings(section);
  }, [onSettings]);
  return <div className="experiment-workbench">
    <div className="experiment-editor-column">
    <div className="experiment-editors" id="workspace-content" tabIndex={-1}>
    <div id="panel-mas" hidden={!visible || !canvas} role="region" aria-label="实验编辑">
      <Mas key={bundle.id} {...common} meta={meta} active={visible && canvas} requestedSettings={requestedSettings}
        onWorkspace={onWorkspace} onResources={onResources} onSettings={configure} selectedResource={selectedResource}
        resourcePurpose={resourcePurpose} trainingJump={jump} />
    </div>
    <RetainedPanel id="experiment" label="实验配置" active={visible && active === 'experiment'}>
      <Experiment {...common} setExpId={setExpId} />
    </RetainedPanel>
    <RetainedPanel id="monitor" label="实验监控" active={visible && active === 'monitor'}>
      <MonitorConnection expId={bundle.id} visible={visible && active === 'monitor'} />
    </RetainedPanel>
    <RetainedPanel id="records" label="训练记录" active={visible && active === 'records' && !samples}>
      <TrainingHistory experimentId={bundle.id} active={visible && active === 'records' && !samples} onSamples={openSamples} />
    </RetainedPanel>
    {samples && <div hidden={!visible} role="region" aria-label="训练采样结果">
      <Suspense fallback={<p className="sample-empty">加载采样结果页面…</p>}>
        <SampleResults key={`${bundle.id}:${samples.runId}`} experimentId={bundle.id} selection={samples}
          active={visible} onNavigate={onSamples} onBack={backToRecords} />
      </Suspense>
    </div>}
    </div>
    <RunConsole experimentId={bundle.id} active={visible && (!samples || !!trainingConsole)}
      hidden={!!samples && !trainingConsole} requestedRunId={consoleRun} requestedOpen={trainingConsole} onSamples={openSamples} />
    </div>
  </div>;
});
