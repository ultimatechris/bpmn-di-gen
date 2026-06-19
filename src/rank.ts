import type { LayoutEdge, LayoutNode } from './model.js';

interface Component {
  ids: string[];
  minimumOrder: number;
  rank: number;
}

export function assignRanks(nodes: LayoutNode[], edges: LayoutEdge[]): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) adjacency.get(edge.sourceId)?.push(edge.targetId);
  for (const targets of adjacency.values()) targets.sort((a, b) => a.localeCompare(b));

  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: Component[] = [];

  const visit = (id: string): void => {
    indices.set(id, index);
    lowLinks.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);

    for (const target of adjacency.get(id) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(target)!));
      }
    }

    if (lowLinks.get(id) === indices.get(id)) {
      const ids: string[] = [];
      let current: string;
      do {
        current = stack.pop()!;
        onStack.delete(current);
        ids.push(current);
      } while (current !== id);
      ids.sort((a, b) => nodeById.get(a)!.order - nodeById.get(b)!.order || a.localeCompare(b));
      components.push({
        ids,
        minimumOrder: Math.min(...ids.map((item) => nodeById.get(item)!.order)),
        rank: 0,
      });
    }
  };

  for (const node of [...nodes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    if (!indices.has(node.id)) visit(node.id);
  }

  const componentByNode = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    for (const id of component.ids) componentByNode.set(id, componentIndex);
  });
  const outgoing = new Map(components.map((_, componentIndex) => [componentIndex, new Set<number>()]));
  const indegree = new Array(components.length).fill(0) as number[];
  for (const edge of edges) {
    const source = componentByNode.get(edge.sourceId)!;
    const target = componentByNode.get(edge.targetId)!;
    if (source !== target && !outgoing.get(source)!.has(target)) {
      outgoing.get(source)!.add(target);
      indegree[target] += 1;
    }
  }

  const queue = components.map((_, i) => i).filter((i) => indegree[i] === 0)
    .sort((a, b) => components[a].minimumOrder - components[b].minimumOrder);
  while (queue.length) {
    const current = queue.shift()!;
    for (const target of [...outgoing.get(current)!].sort((a, b) => components[a].minimumOrder - components[b].minimumOrder)) {
      components[target].rank = Math.max(components[target].rank, components[current].rank + 1);
      indegree[target] -= 1;
      if (indegree[target] === 0) {
        queue.push(target);
        queue.sort((a, b) => components[a].minimumOrder - components[b].minimumOrder);
      }
    }
  }

  for (const component of components) {
    component.ids.forEach((id, offset) => {
      const node = nodeById.get(id)!;
      node.rank = component.rank + offset;
    });
  }

  for (const edge of edges) {
    edge.backward = nodeById.get(edge.targetId)!.rank <= nodeById.get(edge.sourceId)!.rank;
  }
}
