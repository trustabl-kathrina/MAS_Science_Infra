export interface TreeNode {
  node_id: string;
  parent_id: string | null;
  kind: 'query' | 'rollout';
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
    tree_id: string;
    query: string;
    query_truncated: boolean;
    group_id: string;
    mode: 'train' | 'val';
    revision: number;
    updated_at: string | null;
    nodes: TreeNode[];
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
