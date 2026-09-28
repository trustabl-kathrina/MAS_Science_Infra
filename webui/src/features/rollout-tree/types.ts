export interface TreeNode {
  node_id: string;
  parent_id: string | null;
  kind: 'query' | 'rollout' | 'execution' | 'outcome';
  rollout_id?: string | null;
  result_node_id?: string | null;
  agent_id?: string | null;
  agent_kind?: 'agent' | 'tool' | null;
  turn?: number | null;
  summary?: string | null;
  detail_ref?: string | null;
  origin: 'initial' | 'independent_fill' | 'branch' | null;
  status: string | null;
  store_status: string | null;
  training_status: string | null;
  terminal_unconfirmed?: boolean;
  missing_result_fields?: string[];
  record_issues: string[];
  attempt_id: string | null;
  attempt_sequence: number;
  site_id: string | null;
  window_id: string | null;
  event_id: string | null;
  boundary_snapshot_ref: string | null;
  reward: number | null;
  verdict: string | null;
  execution_error: string | null;
  judgments: Record<string, unknown>[];
  previous_attempts: Record<string, unknown>[];
  decision: Record<string, unknown>;
  metrics: Record<string, unknown>;
}
export interface TreeEdge {
  source_node_id: string;
  target_node_id: string;
  kind: 'sequence' | 'branch';
  window_id?: string | null;
  snapshot_ref?: string | null;
  site_id?: string | null;
}
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export interface ExecutionDetail {
  node_id: string;
  rollout_id?: string;
  attempt_id?: string;
  input?: JSONValue;
  output?: JSONValue;
  reasoning?: JSONValue;
  tool_calls?: JSONValue;
  observation?: JSONValue;
  model?: string | null;
  errors?: string[] | null;
  status?: string | null;
  elapsed_seconds?: number | null;
  content_truncated?: boolean | null;
  input_changed?: boolean | null;
  output_origin?: string | null;
}
export interface NodeDetail {
  experiment_id: string;
  run_id: string;
  tree_id: string;
  node: TreeNode;
  detail: ExecutionDetail | null;
  outcome: Outcome | null;
}
export interface Outcome {
  error_details?: { stage: string; error_type: string; message: string } | null;
  answer?: string | null;
  answer_truncated?: boolean;
  reward?: number | null;
  format_ok?: boolean;
  attempt_id?: string;
}
export interface TreeSummary {
  tree_id: string;
  group_id: string;
  mode: 'train' | 'val';
  task_id: string | null;
  query?: string;
  query_truncated?: boolean;
  revision: number;
  created_at: string;
  updated_at: string | null;
  rollout_count: number;
  branch_count: number;
  completed_count: number;
  failed_count: number;
  missing_result_count: number;
  unconfirmed_count: number;
  availability?: 'available' | 'unreadable';
  error?: string;
}
export interface TreeList {
  experiment_id: string;
  run_id: string;
  run_state: string;
  availability: 'missing' | 'empty' | 'available';
  recording_status: string;
  recording_errors?: string[];
  items: TreeSummary[];
  total: number;
  next_offset: number | null;
}
export interface TreeDetail {
  lookup_node_id?: string;
  experiment_id: string;
  run_id: string;
  run_state: string;
  tree: {
    schema_version?: 2 | 3;
    tree_id: string;
    query: string;
    query_truncated: boolean;
    group_id: string;
    mode: 'train' | 'val';
    revision: number;
    updated_at: string | null;
    nodes: TreeNode[];
    edges?: TreeEdge[];
    rollouts?: TreeNode[];
    pending_nodes: TreeNode[];
    outcomes: Record<string, Outcome>;
    plans: { plan_id: string; parent_id: string; status: string; reason: string | null; site_id: string | null }[];
    issues: string[];
  };
  page: {
    total: number;
    next_cursor: string | null;
    truncated: boolean;
    plan_total: number;
    next_plan_offset: number | null;
  };
}
