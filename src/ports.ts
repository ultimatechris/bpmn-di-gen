import type { LayoutEdge } from './model.js';
import type { Bounds, Point } from './types.js';

export type PortSide = 'left' | 'right' | 'top' | 'bottom';

export interface EdgePorts {
  sourceSide: PortSide;
  targetSide: PortSide;
  source: Point;
  target: Point;
}

interface PortAssignment {
  edge: LayoutEdge;
  endpoint: 'source' | 'target';
  nodeId: string;
  side: PortSide;
  remoteCoordinate: number;
}

function pointOnSide(bounds: Bounds, side: PortSide, offset: number): Point {
  if (side === 'left') return { x: bounds.x, y: bounds.y + bounds.height / 2 + offset };
  if (side === 'right') return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 + offset };
  if (side === 'top') return { x: bounds.x + bounds.width / 2 + offset, y: bounds.y };
  return { x: bounds.x + bounds.width / 2 + offset, y: bounds.y + bounds.height };
}

function preferredSides(edge: LayoutEdge, boundaryEventIds: Set<string>): [PortSide, PortSide] {
  if (boundaryEventIds.has(edge.sourceId)) return ['bottom', edge.backward ? 'top' : 'left'];
  if (edge.backward) return ['top', 'top'];
  return ['right', 'left'];
}

/** Assigns separate deterministic ports to every edge sharing a node side. */
export function assignEdgePorts(
  edges: LayoutEdge[],
  boundsById: Map<string, Bounds>,
  boundaryEventIds: Set<string> = new Set(),
  selectSides: (edge: LayoutEdge) => [PortSide, PortSide] = (edge) => preferredSides(edge, boundaryEventIds),
  projectedNodeIds: ReadonlySet<string> = new Set(),
): Map<string, EdgePorts> {
  const assignments: PortAssignment[] = [];
  const sidesByEdge = new Map<string, [PortSide, PortSide]>();

  for (const edge of edges) {
    const source = boundsById.get(edge.sourceId);
    const target = boundsById.get(edge.targetId);
    if (!source || !target) continue;
    const sides = selectSides(edge);
    sidesByEdge.set(edge.id, sides);
    assignments.push({
      edge,
      endpoint: 'source',
      nodeId: edge.sourceId,
      side: sides[0],
      remoteCoordinate: sides[0] === 'left' || sides[0] === 'right'
        ? target.y + target.height / 2
        : target.x + target.width / 2,
    });
    assignments.push({
      edge,
      endpoint: 'target',
      nodeId: edge.targetId,
      side: sides[1],
      remoteCoordinate: sides[1] === 'left' || sides[1] === 'right'
        ? source.y + source.height / 2
        : source.x + source.width / 2,
    });
  }

  const groups = new Map<string, PortAssignment[]>();
  for (const assignment of assignments) {
    const key = `${assignment.nodeId}:${assignment.side}`;
    const group = groups.get(key) ?? [];
    group.push(assignment);
    groups.set(key, group);
  }

  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    group.sort((left, right) => left.remoteCoordinate - right.remoteCoordinate
      || left.edge.id.localeCompare(right.edge.id)
      || left.endpoint.localeCompare(right.endpoint));
    const bounds = boundsById.get(group[0].nodeId)!;
    const verticalSide = group[0].side === 'left' || group[0].side === 'right';
    const available = Math.max(0, (verticalSide ? bounds.height : bounds.width) - 20);
    if (projectedNodeIds.has(group[0].nodeId) && available > 0) {
      const center = verticalSide
        ? bounds.y + bounds.height / 2
        : bounds.x + bounds.width / 2;
      const minimum = center - available / 2;
      const maximum = center + available / 2;
      const separation = Math.min(10, available / Math.max(1, group.length - 1));
      const positions = group.map((assignment) => Math.max(minimum, Math.min(maximum, assignment.remoteCoordinate)));

      for (let index = 1; index < positions.length; index += 1) {
        positions[index] = Math.max(positions[index], positions[index - 1] + separation);
      }
      if (positions.at(-1)! > maximum) {
        positions[positions.length - 1] = maximum;
        for (let index = positions.length - 2; index >= 0; index -= 1) {
          positions[index] = Math.min(positions[index], positions[index + 1] - separation);
        }
      }

      for (let index = 0; index < group.length; index += 1) {
        offsets.set(`${group[index].edge.id}:${group[index].endpoint}`, positions[index] - center);
      }
      continue;
    }
    for (let index = 0; index < group.length; index += 1) {
      const offset = group.length === 1 ? 0 : -available / 2 + available * (index + 1) / (group.length + 1);
      offsets.set(`${group[index].edge.id}:${group[index].endpoint}`, offset);
    }
  }

  const result = new Map<string, EdgePorts>();
  for (const edge of edges) {
    const source = boundsById.get(edge.sourceId);
    const target = boundsById.get(edge.targetId);
    const sides = sidesByEdge.get(edge.id);
    if (!source || !target || !sides) continue;
    result.set(edge.id, {
      sourceSide: sides[0],
      targetSide: sides[1],
      source: pointOnSide(source, sides[0], offsets.get(`${edge.id}:source`) ?? 0),
      target: pointOnSide(target, sides[1], offsets.get(`${edge.id}:target`) ?? 0),
    });
  }
  return result;
}

export function outsideStub(point: Point, side: PortSide, distance: number): Point {
  if (side === 'left') return { x: point.x - distance, y: point.y };
  if (side === 'right') return { x: point.x + distance, y: point.y };
  if (side === 'top') return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}
