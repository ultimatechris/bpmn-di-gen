import type { LayoutEdge, LayoutNode } from './model.js';

interface Component {
  ids: string[];
  minimumOrder: number;
  rank: number;
}

interface VisitFrame {
  id: string;
  nextTarget: number;
  parentId?: string;
}

function pushReady(queue: number[], value: number, components: Component[]): void {
  queue.push(value);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (components[queue[parent]].minimumOrder <= components[queue[index]].minimumOrder) break;
    [queue[parent], queue[index]] = [queue[index], queue[parent]];
    index = parent;
  }
}

function popReady(queue: number[], components: Component[]): number | undefined {
  const first = queue[0];
  const last = queue.pop();
  if (last === undefined || queue.length === 0) return first;
  queue[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= queue.length) break;
    let smallest = left;
    if (right < queue.length
      && components[queue[right]].minimumOrder < components[queue[left]].minimumOrder) {
      smallest = right;
    }
    if (components[queue[index]].minimumOrder <= components[queue[smallest]].minimumOrder) break;
    [queue[index], queue[smallest]] = [queue[smallest], queue[index]];
    index = smallest;
  }
  return first;
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

  const startVisit = (id: string, parentId?: string): VisitFrame => {
    indices.set(id, index);
    lowLinks.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    return { id, nextTarget: 0, parentId };
  };

  for (const node of [...nodes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    if (indices.has(node.id)) continue;
    const visitStack: VisitFrame[] = [startVisit(node.id)];
    while (visitStack.length) {
      const frame = visitStack[visitStack.length - 1];
      const targets = adjacency.get(frame.id) ?? [];
      if (frame.nextTarget < targets.length) {
        const target = targets[frame.nextTarget++];
        if (!indices.has(target)) {
          visitStack.push(startVisit(target, frame.id));
        } else if (onStack.has(target)) {
          lowLinks.set(frame.id, Math.min(lowLinks.get(frame.id)!, indices.get(target)!));
        }
        continue;
      }

      visitStack.pop();
      if (frame.parentId !== undefined) {
        lowLinks.set(frame.parentId, Math.min(lowLinks.get(frame.parentId)!, lowLinks.get(frame.id)!));
      }
      if (lowLinks.get(frame.id) === indices.get(frame.id)) {
        const ids: string[] = [];
        let current: string;
        do {
          current = stack.pop()!;
          onStack.delete(current);
          ids.push(current);
        } while (current !== frame.id);
        ids.sort((a, b) => nodeById.get(a)!.order - nodeById.get(b)!.order || a.localeCompare(b));
        components.push({
          ids,
          minimumOrder: ids.reduce(
            (minimum, item) => Math.min(minimum, nodeById.get(item)!.order),
            Number.POSITIVE_INFINITY,
          ),
          rank: 0,
        });
      }
    }
  }

  const componentByNode = new Map<string, number>();
  const offsetByNode = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.ids.forEach((id, offset) => {
      componentByNode.set(id, componentIndex);
      offsetByNode.set(id, offset);
    });
  });
  const outgoing = components.map(() => new Map<number, number>());
  const indegree = new Array(components.length).fill(0) as number[];
  for (const edge of edges) {
    const source = componentByNode.get(edge.sourceId)!;
    const target = componentByNode.get(edge.targetId)!;
    if (source === target) continue;
    const previousGap = outgoing[source].get(target);
    if (previousGap === undefined) indegree[target] += 1;
    const gap = offsetByNode.get(edge.sourceId)! + 1;
    outgoing[source].set(target, Math.max(previousGap ?? 0, gap));
  }

  const queue: number[] = [];
  components.forEach((_, componentIndex) => {
    if (indegree[componentIndex] === 0) pushReady(queue, componentIndex, components);
  });
  while (queue.length) {
    const current = popReady(queue, components)!;
    const targets = [...outgoing[current]].sort(([a], [b]) => components[a].minimumOrder - components[b].minimumOrder);
    for (const [target, gap] of targets) {
      const nextRank = components[current].rank + gap;
      components[target].rank = Math.max(components[target].rank, nextRank);
      indegree[target] -= 1;
      if (indegree[target] === 0) {
        pushReady(queue, target, components);
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
