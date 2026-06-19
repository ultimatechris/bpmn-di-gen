import type { Bounds, Point } from './types.js';

export interface ExistingDiElement {
  bounds?: Bounds;
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
        if (b && b.width > 0 && b.height > 0) {
          result.set(elementId, { bounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
        }
      } else if (element.$type === 'bpmndi:BPMNEdge') {
        const points: Point[] = (element.waypoint ?? []).map((wp: any) => ({ x: wp.x, y: wp.y }));
        if (points.length >= 2) {
          result.set(elementId, { points });
        }
      }
    }
  }
  return result;
}
