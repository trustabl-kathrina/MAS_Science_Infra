import { experimentQuery, request } from '../../shared/api/http';
import type { HealthResponse, LlmOptionsResponse } from '../../shared/api/types';

export const llmApi = {
  llmHealth: (id: string, body: { base_url?: string; api_key?: string; model?: string; kind?: string } = {}) =>
    request<HealthResponse>(`/api/llm/health?${experimentQuery(id)}`, { method: 'POST', body: JSON.stringify(body) }),
  llmOptions: (id: string, body: { kind: string; base_url?: string; api_key?: string; port?: number }, signal?: AbortSignal) =>
    request<LlmOptionsResponse>(`/api/llm/options?${experimentQuery(id)}`, { method: 'POST', body: JSON.stringify(body), signal }),
  llmStart: (id: string) =>
    request<{ run_id: string; base_url: string; reused?: boolean; models?: string[] }>(`/api/llm/start?${experimentQuery(id)}`, { method: 'POST' }),
  llmStop: (id: string) => request<{ stopped?: string[] }>(`/api/llm/stop?${experimentQuery(id)}`, { method: 'POST' }),
};
