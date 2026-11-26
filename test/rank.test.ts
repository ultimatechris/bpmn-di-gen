import { describe, expect, it } from 'vitest';
import type { LayoutEdge, LayoutNode } from '../src/model.js';
import { assignRanks } from '../src/rank.js';

function node(index: number): LayoutNode {
  return {
    id: `Node_${index}`,
    type: 'bpmn:Task',
    element: {},
    width: 100,
    height: 80,
    rank: 0,
    order: index,
  };
}

function edge(index: number, sourceId: string, targetId: string): LayoutEdge {
  return {
    id: `Flow_${index}`,
    type: 'sequence',
    element: {},
    sourceId,
    targetId,
    backward: false,
  };
}

describe('rank assignment', () => {
  it('places a cycle exit after the member that leads to it', () => {
    const [first, second, third, exit] = [0, 1, 2, 3].map(node);
    const edges = [
      edge(0, first.id, second.id),
      edge(1, second.id, third.id),
      edge(2, third.id, first.id),
      edge(3, first.id, exit.id),
      edge(4, third.id, exit.id),
    ];

    assignRanks([first, second, third, exit], edges);

    expect(exit.rank).toBe(third.rank + 1);
    expect(edges.filter((item) => item.backward).map((item) => item.id)).toEqual(['Flow_2']);
  });

  it('handles a deep process without using the JavaScript call stack', () => {
    const nodes = Array.from({ length: 20_000 }, (_, index) => node(index));
    const edges = nodes.slice(1).map((target, index) => edge(index, nodes[index].id, target.id));

    assignRanks(nodes, edges);

    expect(nodes[0].rank).toBe(0);
    expect(nodes.at(-1)?.rank).toBe(19_999);
    expect(edges.every((item) => !item.backward)).toBe(true);
  });

  it('handles a large strongly connected component without argument or call stack overflow', () => {
    const nodes = Array.from({ length: 20_000 }, (_, index) => node(index));
    const edges = nodes.map((source, index) => edge(index, source.id, nodes[(index + 1) % nodes.length].id));

    assignRanks(nodes, edges);

    expect(nodes[0].rank).toBe(0);
    expect(nodes.at(-1)?.rank).toBe(19_999);
    expect(edges.at(-1)?.backward).toBe(true);
  });

  it('assigns deterministic ranks to many branches that become ready together', () => {
    const nodes = Array.from({ length: 1_002 }, (_, index) => node(index));
    const edges = nodes.slice(1, -1).flatMap((branch, index) => [
      edge(index * 2, nodes[0].id, branch.id),
      edge(index * 2 + 1, branch.id, nodes.at(-1)!.id),
    ]);

    assignRanks(nodes, edges);

    expect(nodes.slice(1, -1).every((item) => item.rank === 1)).toBe(true);
    expect(nodes.at(-1)?.rank).toBe(2);
  });
});
