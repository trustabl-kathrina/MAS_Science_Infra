import type { Connection } from '@xyflow/react';
import type { Palette } from '../../../shared/api/types';
import type { EdgeKind, GraphEdge, GraphNode } from '../types';
import { EDGE_KINDS, KNOWN_TOOLS, edgeDefinition, isEdgeKind } from './edgeDefinitions';

export interface RelationOption { kind: EdgeKind; reason: string }
export type EdgeRules = ReturnType<typeof createEdgeRules>;

export function edgeConnection(edge: GraphEdge): Connection {
  return {
    source: edge.source, target: edge.target,
    sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null,
  };
}

export function reverseConnection(connection: Connection): Connection {
  return {
    source: connection.target, target: connection.source,
    sourceHandle: connection.targetHandle, targetHandle: connection.sourceHandle,
  };
}

export function createEdgeRules(nodes: GraphNode[], edges: GraphEdge[], palette: Palette = {}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphEdge[]>();
  const incomingRoutes = new Map<string, GraphEdge[]>();
  const isTool = (node?: GraphNode) => node?.type === 'tool' || node?.data.kind === 'tool';
  const isRouter = (node?: GraphNode) => node?.type === 'router';
  const isPool = (node?: GraphNode) => node?.type === 'pool';
  const isPoolTarget = (node?: GraphNode) => Boolean(node && !isTool(node) && !isRouter(node) && !isPool(node)
    && (node.data.kind === 'planner' || node.data.kind === 'verifier' || node.data.kind === 'blank' || !node.data.kind));
  const tools = new Set([
    ...(palette.tools ?? KNOWN_TOOLS),
    ...nodes.filter(isTool).map((node) => node.id),
  ]);
  const supported = new Set(palette.edge_kinds ?? EDGE_KINDS);
  for (const edge of edges) {
    const list = outgoing.get(edge.source) || [];
    list.push(edge);
    outgoing.set(edge.source, list);
    if (edge.data?.kind === 'route') {
      const routes = incomingRoutes.get(edge.target) || [];
      routes.push(edge);
      incomingRoutes.set(edge.target, routes);
    }
  }

  const normalize = (connection: Connection): Connection =>
    isTool(nodeById.get(connection.source)) && nodeById.get(connection.target)?.type === 'agent'
      ? reverseConnection(connection) : connection;

  const normalizeEdit = (connection: Connection, edge: GraphEdge, kind = edge.data?.kind || 'message'): Connection => {
    const geometryOnly = connection.source === edge.source && connection.target === edge.target && kind === edge.data?.kind;
    return geometryOnly || kind !== 'tool_call' ? connection : normalize(connection);
  };

  const error = (connection: Connection, kind: string, replacing?: string): string => {
    const source = nodeById.get(connection.source);
    const target = nodeById.get(connection.target);
    if (!source || !target) return '连接对象已不存在。';
    if (source.id === target.id) return '请连接两个不同的实体。';
    if (!isEdgeKind(kind) || !supported.has(kind)) return '当前不支持此关系类型。';
    const other = (outgoing.get(source.id) || []).filter((edge) => edge.id !== replacing);
    if (isPool(source) || isPool(target) || (isRouter(source) && !isRouter(target))) {
      if (isRouter(source) && isPool(target)) {
        if (kind !== 'route') return 'Router 只能用路由关系连接 tool-agent pool。';
        if (other.some((edge) => edge.data?.kind === 'route' || nodeById.get(edge.target)?.type === 'pool')) {
          return 'Router 只能连接一个 tool-agent pool。';
        }
        return '';
      }
      if (isRouter(source)) return 'Router 的下游只能是 tool-agent pool。';
      if (isPool(target)) return '只有 Router 可以连接 tool-agent pool。';
      if (isPool(source)) {
        if (kind !== 'message') return 'tool-agent pool 使用消息关系连接下游 Agent。';
        if (!isPoolTarget(target)) return 'tool-agent pool 的下游必须是 planner、verifier 或自定义 Agent。';
        if (other.some((edge) => edge.data?.kind === 'message')) return 'tool-agent pool 只能有一个下游。';
        return '';
      }
    }
    if (isRouter(target)) {
      if (isTool(source) || isPool(source)) return 'Router 的上游必须是 Agent。';
      if (kind !== 'route') return 'Router 使用任务路由关系连接上游 Agent。';
    } else if (isTool(source) && isTool(target)) {
      return '工具之间不能直接连接。';
    }
    if (kind === 'tool_call') {
      if (source.type !== 'agent' || isTool(source) || !isTool(target)) return '工具关系必须由 Agent 指向 Tool 或 tool-agent。';
      if (!tools.has(target.id)) return '当前运行时不支持该工具。';
    } else if (!isRouter(source) && !isRouter(target) && (source.type !== 'agent' || target.type !== 'agent' || isTool(source) || isTool(target))) {
      return 'Agent 协作不能连接 Tool。';
    }
    if (other.some((edge) => edge.target === target.id && edge.data?.kind === kind)) {
      return kind === 'tool_call' ? '该 Agent 已具备此工具。' : '该关系已经存在。';
    }
    if (kind === 'tool_call') return '';
    if (kind === 'feedback') {
      const matches = (node: GraphNode, roles: string[]) =>
        roles.includes(node.id) || roles.includes(node.data.role || '') || roles.includes(node.data.kind || '');
      if (!matches(source, ['verifier', 'critic'])) return '反馈方必须是 verifier 或 critic。';
      if (!matches(target, ['planner']) || target.id === 'hub') return '反馈接收方必须是 planner。';
    }
    if (kind === 'route' && isRouter(target)) {
      return '';
    }
    if (kind === 'route' && (incomingRoutes.get(target.id) || []).some((edge) => edge.id !== replacing)) {
      return '接收方已有输入路由，最多只能接受一条。';
    }
    if (other.some((edge) => edge.data?.kind === kind) && !(kind === 'route' && isRouter(target))) {
      return `发送方已有${edgeDefinition(kind).title}目标，当前运行时不支持同类型多目标输出。`;
    }
    if ((kind === 'route' || kind === 'message') && other.some((edge) =>
      edge.data?.kind === (kind === 'route' ? 'message' : 'route'))) {
      return '同一发送方不能同时配置消息与路由：路由会遮蔽消息，不会并行执行。';
    }
    return '';
  };

  const options = (raw: Connection, replacing?: string): RelationOption[] => {
    const connection = normalize(raw);
    const parties = [nodeById.get(connection.source), nodeById.get(connection.target)];
    const hasTool = parties.some(isTool);
    const hasPool = parties.some(isPool);
    const hasRouter = parties.some(isRouter);
    const kinds = hasPool && isPool(nodeById.get(connection.source)) ? ['message'] as const
      : hasRouter || hasPool ? ['route'] as const
      : hasTool ? ['tool_call'] as const
        : EDGE_KINDS.filter((kind) => kind !== 'tool_call');
    return kinds.map((kind) => ({ kind, reason: error(connection, kind, replacing) }));
  };

  return { nodeById, normalize, normalizeEdit, error, options };
}
