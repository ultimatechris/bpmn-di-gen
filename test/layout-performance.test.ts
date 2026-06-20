import { describe, expect, it } from 'vitest';
import { layoutModel } from '../src/layout.js';
import type { LayoutModel, LayoutNode, ProcessGraph } from '../src/model.js';

describe('layout scaling', () => {
  it('reads node widths linearly while placing a large graph', () => {
    let widthReads = 0;
    const nodes: LayoutNode[] = Array.from({ length: 1_000 }, (_, order) => {
      const node: LayoutNode = {
        id: `Node_${order}`,
        type: 'bpmn:Task',
        element: { id: `Node_${order}` },
        width: 100,
        height: 80,
        rank: 0,
        order,
      };
      Object.defineProperty(node, 'width', {
        configurable: true,
        get: () => {
          widthReads += 1;
          return 100;
        },
        set: () => undefined,
      });
      return node;
    });
    const graph: ProcessGraph = {
      process: { id: 'Process_Performance' },
      nodes,
      edges: [],
      lanes: [],
      roots: [],
      width: 0,
      height: 0,
      participantOrder: 0,
      boundaryEvents: [],
      annotations: [],
      associations: [],
      dataElements: [],
      dataAssociations: [],
      groups: [],
    };
    const model: LayoutModel = {
      definitions: {},
      planeElement: graph.process,
      graphs: [graph],
      messageEdges: [],
      diagnostics: [],
      blackBoxParticipants: [],
    };

    layoutModel(model, {});

    expect(widthReads).toBeLessThan(nodes.length * 10);
  });
});
