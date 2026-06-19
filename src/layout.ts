import type { LayoutModel, LayoutLane, LayoutNode, ProcessGraph } from './model.js';
import type { Bounds, LayoutOptions, Point } from './types.js';
import { assignRanks } from './rank.js';

interface Spacing {
  rankGap: number;
  nodeGap: number;
  paddingX: number;
  paddingY: number;
  laneMinHeight: number;
  poolGap: number;
}

const SPACING: Record<NonNullable<LayoutOptions['spacing']>, Spacing> = {
  compact: { rankGap: 70, nodeGap: 25, paddingX: 35, paddingY: 25, laneMinHeight: 110, poolGap: 50 },
  normal: { rankGap: 110, nodeGap: 40, paddingX: 55, paddingY: 35, laneMinHeight: 140, poolGap: 70 },
  spacious: { rankGap: 160, nodeGap: 60, paddingX: 80, paddingY: 50, laneMinHeight: 180, poolGap: 100 },
};

const POOL_HEADER = 30;
const LANE_HEADER = 30;

function descendants(lane: LayoutLane, byId: Map<string, LayoutLane>): LayoutLane[] {
  if (!lane.childIds.length) return [lane];
  return lane.childIds.flatMap((id) => descendants(byId.get(id)!, byId));
}

function effectiveLeaf(node: LayoutNode, leaves: LayoutLane[], byId: Map<string, LayoutLane>): LayoutLane {
  const selected = node.laneId ? byId.get(node.laneId) : undefined;
  if (!selected) return leaves[0];
  return descendants(selected, byId)[0];
}

function columnWidth(nodes: LayoutNode[]): number {
  return Math.max(100, ...nodes.map((node) => node.width));
}

function layoutGraph(graph: ProcessGraph, x: number, y: number, spacing: Spacing): void {
  assignRanks(graph.nodes, graph.edges);
  const maxRank = Math.max(0, ...graph.nodes.map((node) => node.rank));
  const stepX = columnWidth(graph.nodes) + spacing.rankGap;
  const contentWidth = maxRank * stepX + columnWidth(graph.nodes) + spacing.paddingX * 2;

  if (!graph.lanes.length) {
    const byRank = new Map<number, LayoutNode[]>();
    for (const node of graph.nodes) {
      const group = byRank.get(node.rank) ?? [];
      group.push(node);
      byRank.set(node.rank, group);
    }
    const maximumColumnHeight = Math.max(0, ...[...byRank.values()].map((nodes) =>
      nodes.reduce((total, node) => total + node.height, 0) + Math.max(0, nodes.length - 1) * spacing.nodeGap,
    ));
    const contentHeight = Math.max(spacing.laneMinHeight, maximumColumnHeight + spacing.paddingY * 2);
    const poolOffset = graph.participant ? POOL_HEADER : 0;
    const contentX = x + poolOffset + spacing.paddingX;
    for (const [rank, nodes] of byRank) {
      nodes.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const totalHeight = nodes.reduce((total, node) => total + node.height, 0)
        + Math.max(0, nodes.length - 1) * spacing.nodeGap;
      let nodeY = y + (contentHeight - totalHeight) / 2;
      for (const node of nodes) {
        node.bounds = {
          x: contentX + rank * stepX + (columnWidth(graph.nodes) - node.width) / 2,
          y: nodeY,
          width: node.width,
          height: node.height,
        };
        nodeY += node.height + spacing.nodeGap;
      }
    }
    graph.width = contentWidth + poolOffset;
    graph.height = contentHeight;
    if (graph.participant) graph.participant.bounds = { x, y, width: graph.width, height: graph.height };
    return;
  }

  const laneById = new Map(graph.lanes.map((lane) => [lane.id, lane]));
  const leaves = graph.lanes.filter((lane) => !lane.childIds.length);
  const maximumDepth = Math.max(...graph.lanes.map((lane) => lane.depth));
  const participantOffset = graph.participant ? POOL_HEADER : 0;
  const contentX = x + participantOffset + (maximumDepth + 1) * LANE_HEADER + spacing.paddingX;
  const right = contentX + contentWidth - spacing.paddingX;
  const leafHeights = new Map<string, number>();

  for (const leaf of leaves) {
    const laneNodes = graph.nodes.filter((node) => effectiveLeaf(node, leaves, laneById).id === leaf.id);
    const rankCounts = new Map<number, LayoutNode[]>();
    for (const node of laneNodes) {
      const group = rankCounts.get(node.rank) ?? [];
      group.push(node);
      rankCounts.set(node.rank, group);
    }
    const needed = Math.max(0, ...[...rankCounts.values()].map((nodes) =>
      nodes.reduce((total, node) => total + node.height, 0) + Math.max(0, nodes.length - 1) * spacing.nodeGap,
    ));
    leafHeights.set(leaf.id, Math.max(spacing.laneMinHeight, needed + spacing.paddingY * 2));
  }

  let laneY = y;
  for (const leaf of leaves) {
    const height = leafHeights.get(leaf.id)!;
    leaf.bounds = {
      x: x + participantOffset + leaf.depth * LANE_HEADER,
      y: laneY,
      width: right - (x + participantOffset + leaf.depth * LANE_HEADER),
      height,
    };
    const laneNodes = graph.nodes.filter((node) => effectiveLeaf(node, leaves, laneById).id === leaf.id);
    const rankGroups = new Map<number, LayoutNode[]>();
    for (const node of laneNodes) {
      const group = rankGroups.get(node.rank) ?? [];
      group.push(node);
      rankGroups.set(node.rank, group);
    }
    for (const [rank, nodes] of rankGroups) {
      nodes.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const totalHeight = nodes.reduce((total, node) => total + node.height, 0)
        + Math.max(0, nodes.length - 1) * spacing.nodeGap;
      let nodeY = laneY + (height - totalHeight) / 2;
      for (const node of nodes) {
        node.bounds = {
          x: contentX + rank * stepX + (columnWidth(graph.nodes) - node.width) / 2,
          y: nodeY,
          width: node.width,
          height: node.height,
        };
        nodeY += node.height + spacing.nodeGap;
      }
    }
    laneY += height;
  }

  for (const lane of [...graph.lanes].sort((a, b) => b.depth - a.depth)) {
    if (!lane.childIds.length) continue;
    const children = lane.childIds.map((id) => laneById.get(id)!).filter((child) => child.bounds);
    const top = Math.min(...children.map((child) => child.bounds!.y));
    const bottom = Math.max(...children.map((child) => child.bounds!.y + child.bounds!.height));
    const laneX = x + participantOffset + lane.depth * LANE_HEADER;
    lane.bounds = { x: laneX, y: top, width: right - laneX, height: bottom - top };
  }

  graph.width = right - x;
  graph.height = laneY - y;
  if (graph.participant) graph.participant.bounds = { x, y, width: graph.width, height: graph.height };
}

function centerY(bounds: Bounds): number {
  return bounds.y + bounds.height / 2;
}

function centerX(bounds: Bounds): number {
  return bounds.x + bounds.width / 2;
}

function deduplicate(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

function routeSequenceEdges(graph: ProcessGraph): void {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  let backwardChannel = 0;
  const graphTop = graph.participant?.bounds?.y
    ?? (graph.lanes.length
      ? Math.min(...graph.lanes.map((lane) => lane.bounds!.y))
      : Math.min(...graph.nodes.map((node) => node.bounds!.y)) - 35);
  for (const edge of graph.edges) {
    const source = nodes.get(edge.sourceId)!.bounds!;
    const target = nodes.get(edge.targetId)!.bounds!;
    const sourcePoint = { x: source.x + source.width, y: centerY(source) };
    const targetPoint = { x: target.x, y: centerY(target) };
    if (!edge.backward) {
      if (sourcePoint.y === targetPoint.y) {
        edge.points = [sourcePoint, targetPoint];
      } else {
        const middleX = (sourcePoint.x + targetPoint.x) / 2;
        edge.points = deduplicate([
          sourcePoint,
          { x: middleX, y: sourcePoint.y },
          { x: middleX, y: targetPoint.y },
          targetPoint,
        ]);
      }
    } else {
      const channelY = graphTop + 12 + backwardChannel * 8;
      backwardChannel += 1;
      edge.points = deduplicate([
        sourcePoint,
        { x: sourcePoint.x + 25, y: sourcePoint.y },
        { x: sourcePoint.x + 25, y: channelY },
        { x: targetPoint.x - 25, y: channelY },
        { x: targetPoint.x - 25, y: targetPoint.y },
        targetPoint,
      ]);
    }
  }
}

function endpointBounds(model: LayoutModel, id: string): Bounds | undefined {
  for (const graph of model.graphs) {
    const node = graph.nodes.find((item) => item.id === id);
    if (node?.bounds) return node.bounds;
    if (graph.participant?.id === id) return graph.participant.bounds;
  }
  return undefined;
}

function routeMessageEdges(model: LayoutModel): void {
  for (const edge of model.messageEdges) {
    const source = endpointBounds(model, edge.sourceId);
    const target = endpointBounds(model, edge.targetId);
    if (!source || !target) {
      model.diagnostics.push({
        severity: 'warning',
        code: 'UNROUTABLE_MESSAGE_FLOW',
        message: `Message flow ${edge.id} could not be routed because an endpoint has no shape.`,
        elementId: edge.id,
      });
      continue;
    }
    const downward = centerY(target) >= centerY(source);
    const start = { x: centerX(source), y: downward ? source.y + source.height : source.y };
    const end = { x: centerX(target), y: downward ? target.y : target.y + target.height };
    const middleY = (start.y + end.y) / 2;
    edge.points = deduplicate([start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end]);
  }
}

function transposeBounds(bounds: Bounds): Bounds {
  return { x: bounds.y, y: bounds.x, width: bounds.height, height: bounds.width };
}

function applyTopToBottom(model: LayoutModel): void {
  for (const graph of model.graphs) {
    for (const node of graph.nodes) node.bounds = transposeBounds(node.bounds!);
    for (const lane of graph.lanes) lane.bounds = transposeBounds(lane.bounds!);
    if (graph.participant?.bounds) graph.participant.bounds = transposeBounds(graph.participant.bounds);
    [graph.width, graph.height] = [graph.height, graph.width];
  }
}

export function layoutModel(model: LayoutModel, options: LayoutOptions): void {
  const spacing = SPACING[options.spacing ?? 'normal'];
  let y = 50;
  for (const graph of model.graphs) {
    layoutGraph(graph, 50, y, spacing);
    y += graph.height + spacing.poolGap;
  }
  if (options.direction === 'top-to-bottom') applyTopToBottom(model);
  for (const graph of model.graphs) routeSequenceEdges(graph);
  routeMessageEdges(model);
}
