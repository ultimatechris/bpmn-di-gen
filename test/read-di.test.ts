import { describe, expect, it } from 'vitest';
import { readExistingDi } from '../src/read-di.js';

describe('existing DI reader', () => {
  it('accepts only finite positive bounds and finite edge waypoints', () => {
    const definitions = {
      diagrams: [{
        plane: {
          planeElement: [
            {
              $type: 'bpmndi:BPMNShape',
              bpmnElement: { id: 'Valid_Shape' },
              bounds: { x: 10, y: 20, width: 100, height: 80 },
            },
            {
              $type: 'bpmndi:BPMNShape',
              bpmnElement: { id: 'Invalid_Shape' },
              bounds: { x: 10, y: 20, width: Number.POSITIVE_INFINITY, height: 80 },
            },
            {
              $type: 'bpmndi:BPMNEdge',
              bpmnElement: { id: 'Valid_Edge' },
              waypoint: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
            },
            {
              $type: 'bpmndi:BPMNEdge',
              bpmnElement: { id: 'Invalid_Edge' },
              waypoint: [{ x: 1, y: 2 }, { x: Number.NaN, y: 4 }],
            },
          ],
        },
      }],
    };

    const di = readExistingDi(definitions);
    expect([...di.keys()]).toEqual(['Valid_Shape', 'Valid_Edge']);
  });
});
