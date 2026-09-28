import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Node, NodeChange, XYPosition } from '@xyflow/react';

type Placement = { position: XYPosition; dragging: boolean };

/** Keep manual placement separate from server data and automatic layout. */
export function useDraggableNodes<N extends Node>(nodes: N[]) {
  const [placements, setPlacements] = useState<Map<string, Placement>>(() => new Map());
  const ids = useMemo(() => new Set(nodes.map(node => node.id)), [nodes]);
  useEffect(() => {
    setPlacements(previous => {
      if ([...previous.keys()].every(id => ids.has(id))) return previous;
      return new Map([...previous].filter(([id]) => ids.has(id)));
    });
  }, [ids]);

  const onNodesChange = useCallback((changes: NodeChange<N>[]) => {
    const positions = changes.filter(change => change.type === 'position');
    if (!positions.length) return;
    setPlacements(previous => {
      let next = previous;
      for (const change of positions) {
        if (!change.position) continue;
        const saved = next.get(change.id);
        const dragging = change.dragging ?? false;
        if (saved?.position.x === change.position.x && saved.position.y === change.position.y
          && saved.dragging === dragging) continue;
        if (next === previous) next = new Map(previous);
        next.set(change.id, { position: change.position, dragging });
      }
      return next;
    });
  }, []);

  const draggableNodes = useMemo(() => nodes.map(node => {
    const placement = placements.get(node.id);
    return placement ? { ...node, ...placement } : node;
  }), [nodes, placements]);

  return { nodes: draggableNodes, onNodesChange };
}
