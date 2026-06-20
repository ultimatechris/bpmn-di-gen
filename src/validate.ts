import { BpmnLayoutError } from './errors.js';
import type { Diagnostic } from './types.js';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateGeneratedDefinitions(definitions: any): void {
  const diagnostics: Diagnostic[] = [];
  const diagrams = definitions.diagrams ?? [];
  if (!diagrams.length || diagrams.some((diagram: any) => !diagram.plane)) {
    diagnostics.push({ severity: 'error', code: 'MISSING_DIAGRAM', message: 'Generated BPMN has no diagram plane.' });
  }
  const elements = diagrams.flatMap((diagram: any) => diagram.plane?.planeElement ?? []);
  const semanticIds = new Set<string>();
  const visited = new Set<any>();
  const pending = [definitions];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    if (typeof value.id === 'string' && typeof value.$type === 'string' && !value.$type.startsWith('bpmndi:')) {
      semanticIds.add(value.id);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('$') || key === 'di' || key === 'diagrams') continue;
      if (Array.isArray(child)) {
        for (const item of child) pending.push(item);
      } else pending.push(child);
    }
  }

  for (const element of elements) {
    const semanticId = element.bpmnElement?.id;
    if (!semanticId || !semanticIds.has(semanticId)) {
      diagnostics.push({
        severity: 'error',
        code: 'UNRESOLVED_DI_REFERENCE',
        message: `DI element ${element.id} does not reference a semantic BPMN element.`,
        elementId: element.id,
      });
    }
    if (element.$type === 'bpmndi:BPMNShape') {
      const bounds = element.bounds;
      if (!bounds || !finite(bounds.x) || !finite(bounds.y) || !finite(bounds.width) || !finite(bounds.height)
        || bounds.width <= 0 || bounds.height <= 0) {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_SHAPE_BOUNDS',
          message: `DI shape ${element.id} has invalid bounds.`,
          elementId: element.id,
        });
      }
    } else if (element.$type === 'bpmndi:BPMNEdge') {
      const points = element.waypoint ?? [];
      if (points.length < 2 || points.some((point: any) => !finite(point.x) || !finite(point.y))) {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_EDGE_WAYPOINTS',
          message: `DI edge ${element.id} has invalid waypoints.`,
          elementId: element.id,
        });
      }
    }
  }
  if (diagnostics.length) throw new BpmnLayoutError('Generated BPMN DI failed validation.', diagnostics);
}
