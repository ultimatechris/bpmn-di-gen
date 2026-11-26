import type { Bounds, Point } from './types.js';

export interface ExistingDiElement {
  bounds?: Bounds;
  isExpanded?: boolean;
  points?: Point[];
}

export function readExistingDi(definitions: any): Map<string, ExistingDiElement> {
  const result = new Map<string, ExistingDiElement>();
  for (const diagram of definitions.diagrams ?? []) {
    for (const element of diagram.plane?.planeElement ?? []) {
      const elementId = element.bpmnElement?.id;
      if (!elementId) continue;
      if (element.$type === 'bpmndi:BPMNShape') {
        const b = element.bounds;
        const shape: ExistingDiElement = {};
        if (typeof element.isExpanded === 'boolean') shape.isExpanded = element.isExpanded;
        if (b && b.width > 0 && b.height > 0
          && Number.isFinite(b.x) && Number.isFinite(b.y)
          && Number.isFinite(b.width) && Number.isFinite(b.height)) {
          shape.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
        }
        if (shape.bounds || shape.isExpanded !== undefined) result.set(elementId, shape);
      } else if (element.$type === 'bpmndi:BPMNEdge') {
        const points: Point[] = (element.waypoint ?? []).map((wp: any) => ({ x: wp.x, y: wp.y }));
        if (points.length >= 2 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
          result.set(elementId, { points });
        }
      }
    }
  }
  return result;
}
