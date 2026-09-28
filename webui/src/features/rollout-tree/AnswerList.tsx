import { memo } from 'react';
import { Button } from '../../shared/ui/button';
import { answerName, answerSource, answerState, rewardText } from './model';
import type { Outcome, TreeNode } from './types';

const AnswerCard = memo(function AnswerCard({ node, outcome, selected, onSelect }: {
  node: TreeNode; outcome?: Outcome; selected: boolean; onSelect: (id: string) => void;
}) {
  const state = answerState(node, outcome);
  return <article className={`sample-answer${selected ? ' is-selected' : ''}`} aria-label={answerName(node.node_id)}>
    <header><strong title={node.node_id}>{answerName(node.node_id)}</strong>
      <span className={`sample-state is-${state.tone}`}>{state.label}</span>
      <span className="sample-reward">最终奖励 <b>{rewardText(outcome?.reward)}</b></span></header>
    <p className="sample-source">{answerSource(node)}</p>
    <p className="sample-answer-preview">{outcome?.answer ?? '未记录最终答案'}</p>
    <footer>{outcome?.answer_truncated && <small>已记录答案为截断摘要</small>}
      <Button size="sm" variant="ghost" aria-pressed={selected} onClick={() => onSelect(node.node_id)}>查看详情</Button></footer>
  </article>;
});

export const AnswerList = memo(function AnswerList({ nodes, outcomes, selectedId, onSelect }: {
  nodes: TreeNode[]; outcomes: Record<string, Outcome>; selectedId?: string; onSelect: (id: string) => void;
}) {
  return <div className="sample-answer-list">
    {nodes.map(node => <AnswerCard key={node.node_id} node={node} outcome={outcomes[node.node_id]}
      selected={selectedId === node.node_id} onSelect={onSelect} />)}
    {!nodes.length && <p className="sample-empty">此题目尚无实际生成记录。分支计划不会显示为已执行回答。</p>}
  </div>;
});
