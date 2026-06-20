import type { LayoutModel, LayoutLane, LayoutNode, LayoutParticipant, ProcessGraph } from './model.js';
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
const BLACK_BOX_PARTICIPANT_HEIGHT = 120;
const SUBPROCESS_PADDING = 40;

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
  return nodes.reduce((maximum, node) => Math.max(maximum, node.width), 100);
}

function presizeSubprocesses(graph: ProcessGraph, spacing: Spacing): void {
  for (const node of graph.nodes) {
    if (!node.subGraph) continue;
    if (node.subGraph.width > 0) continue;
    presizeSubprocesses(node.subGraph, spacing);
    layoutGraph(node.subGraph, 0, 0, spacing);
    node.width = node.subGraph.width + SUBPROCESS_PADDING * 2;
    node.height = node.subGraph.height + SUBPROCESS_PADDING * 2;
  }
}

function layoutGraph(graph: ProcessGraph, x: number, y: number, spacing: Spacing): void {
  presizeSubprocesses(graph, spacing);
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const rankEdges = graph.edges.filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));
  assignRanks(graph.nodes, rankEdges);
  const maxRank = graph.nodes.reduce((maximum, node) => Math.max(maximum, node.rank), 0);
  const nodeColumnWidth = columnWidth(graph.nodes);
  const stepX = nodeColumnWidth + spacing.rankGap;
  const contentWidth = maxRank * stepX + nodeColumnWidth + spacing.paddingX * 2;

  if (!graph.lanes.length) {
    const byRank = new Map<number, LayoutNode[]>();
    for (const node of graph.nodes) {
      const group = byRank.get(node.rank) ?? [];
      group.push(node);
      byRank.set(node.rank, group);
    }
    const maximumColumnHeight = [...byRank.values()].reduce((maximum, nodes) => Math.max(
      maximum,
      nodes.reduce((total, node) => total + node.height, 0) + Math.max(0, nodes.length - 1) * spacing.nodeGap,
    ), 0);
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
          x: contentX + rank * stepX + (nodeColumnWidth - node.width) / 2,
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
  const maximumDepth = graph.lanes.reduce((maximum, lane) => Math.max(maximum, lane.depth), 0);
  const participantOffset = graph.participant ? POOL_HEADER : 0;
  const contentX = x + participantOffset + (maximumDepth + 1) * LANE_HEADER + spacing.paddingX;
  const right = contentX + contentWidth - spacing.paddingX;
  const leafHeights = new Map<string, number>();
  const nodesByLeaf = new Map(leaves.map((leaf) => [leaf.id, [] as LayoutNode[]]));

  for (const node of graph.nodes) {
    const leaf = effectiveLeaf(node, leaves, laneById);
    nodesByLeaf.get(leaf.id)!.push(node);
  }

  for (const leaf of leaves) {
    const laneNodes = nodesByLeaf.get(leaf.id)!;
    const rankCounts = new Map<number, LayoutNode[]>();
    for (const node of laneNodes) {
      const group = rankCounts.get(node.rank) ?? [];
      group.push(node);
      rankCounts.set(node.rank, group);
    }
    const needed = [...rankCounts.values()].reduce((maximum, nodes) => Math.max(
      maximum,
      nodes.reduce((total, node) => total + node.height, 0) + Math.max(0, nodes.length - 1) * spacing.nodeGap,
    ), 0);
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
    const laneNodes = nodesByLeaf.get(leaf.id)!;
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
          x: contentX + rank * stepX + (nodeColumnWidth - node.width) / 2,
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
  const boundsById = new Map<string, Bounds>();
  for (const node of graph.nodes) { if (node.bounds) boundsById.set(node.id, node.bounds); }
  for (const be of graph.boundaryEvents) { if (be.bounds) boundsById.set(be.id, be.bounds); }
  const boundaryEventIds = new Set(graph.boundaryEvents.map((be) => be.id));

  let backwardChannel = 0;
  const allBounds = [...boundsById.values()];
  const graphTop = graph.participant?.bounds?.y
    ?? (graph.lanes.length
      ? Math.min(...graph.lanes.map((lane) => lane.bounds!.y))
      : allBounds.length ? Math.min(...allBounds.map((b) => b.y)) - 35 : 0);

  for (const edge of graph.edges) {
    const source = boundsById.get(edge.sourceId);
    const target = boundsById.get(edge.targetId);
    if (!source || !target) continue;

    if (boundaryEventIds.has(edge.sourceId)) {
      // Exception flow: exit from bottom of boundary event, route to target
      const start = { x: centerX(source), y: source.y + source.height };
      const end = { x: target.x, y: centerY(target) };
      const midY = Math.max(start.y + 20, end.y);
      edge.points = deduplicate([start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]);
      continue;
    }

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
  function nodeBounds(graph: ProcessGraph): Bounds | undefined {
    for (const node of graph.nodes) {
      if (node.id === id && node.bounds) return node.bounds;
      if (node.subGraph) {
        const bounds = nodeBounds(node.subGraph);
        if (bounds) return bounds;
      }
    }
    return undefined;
  }

  for (const graph of model.graphs) {
    const bounds = nodeBounds(graph);
    if (bounds) return bounds;
    if (graph.participant?.id === id) return graph.participant.bounds;
  }
  const blackBox = model.blackBoxParticipants.find((p) => p.id === id);
  if (blackBox?.bounds) return blackBox.bounds;
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

function placeDataElements(
  graph: ProcessGraph,
  spacing: Spacing,
  preserve: (id: string) => boolean = () => false,
): void {
  const boundsById = new Map<string, Bounds>();
  for (const node of graph.nodes) { if (node.bounds) boundsById.set(node.id, node.bounds); }

  for (const de of graph.dataElements) {
    if (preserve(de.id)) continue;
    const hostId = de.connectedNodeIds[0];
    const hostBounds = hostId ? boundsById.get(hostId) : undefined;
    de.bounds = {
      x: hostBounds ? hostBounds.x + hostBounds.width / 2 - de.width / 2 : 50,
      y: hostBounds ? Math.max(0, hostBounds.y - de.height - spacing.nodeGap) : 50,
      width: de.width,
      height: de.height,
    };
  }
}

function routeDataAssociations(graph: ProcessGraph): void {
  const boundsById = new Map<string, Bounds>();
  for (const node of graph.nodes) { if (node.bounds) boundsById.set(node.id, node.bounds); }
  for (const de of graph.dataElements) { if (de.bounds) boundsById.set(de.id, de.bounds); }

  for (const da of graph.dataAssociations) {
    const nodeBounds = boundsById.get(da.nodeId);
    const dataBounds = boundsById.get(da.dataElementId);
    if (!nodeBounds || !dataBounds) continue;
    da.points = [
      { x: centerX(nodeBounds), y: nodeBounds.y },
      { x: centerX(dataBounds), y: dataBounds.y + dataBounds.height },
    ];
  }
}

function placeAnnotations(
  graph: ProcessGraph,
  spacing: Spacing,
  preserve: (id: string) => boolean = () => false,
): void {
  const boundsById = new Map<string, Bounds>();
  for (const node of graph.nodes) { if (node.bounds) boundsById.set(node.id, node.bounds); }
  for (const be of graph.boundaryEvents) { if (be.bounds) boundsById.set(be.id, be.bounds); }
  for (const de of graph.dataElements) { if (de.bounds) boundsById.set(de.id, de.bounds); }

  const rightEdge = graph.nodes.reduce((max, n) => n.bounds ? Math.max(max, n.bounds.x + n.bounds.width) : max, 50);
  let annotationY = graph.participant?.bounds?.y ?? (graph.nodes[0]?.bounds?.y ?? 50);

  for (const ann of graph.annotations) {
    if (preserve(ann.id)) {
      if (ann.bounds) annotationY = Math.max(annotationY, ann.bounds.y + ann.bounds.height + spacing.nodeGap);
      continue;
    }
    const connectedBounds = ann.connectedNodeId ? boundsById.get(ann.connectedNodeId) : undefined;
    ann.bounds = {
      x: rightEdge + spacing.rankGap,
      y: connectedBounds ? centerY(connectedBounds) - ann.height / 2 : annotationY,
      width: ann.width,
      height: ann.height,
    };
    annotationY += ann.height + spacing.nodeGap;
  }
}

function routeAssociations(graph: ProcessGraph): void {
  const boundsById = new Map<string, Bounds>();
  for (const node of graph.nodes) { if (node.bounds) boundsById.set(node.id, node.bounds); }
  for (const be of graph.boundaryEvents) { if (be.bounds) boundsById.set(be.id, be.bounds); }
  for (const ann of graph.annotations) { if (ann.bounds) boundsById.set(ann.id, ann.bounds); }
  for (const de of graph.dataElements) { if (de.bounds) boundsById.set(de.id, de.bounds); }

  for (const assoc of graph.associations) {
    const source = boundsById.get(assoc.sourceId);
    const target = boundsById.get(assoc.targetId);
    if (!source || !target) continue;
    assoc.points = [
      { x: source.x + source.width, y: centerY(source) },
      { x: target.x, y: centerY(target) },
    ];
  }
}

function placeBoundaryEvents(graph: ProcessGraph, preserve: (id: string) => boolean = () => false): void {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const be of graph.boundaryEvents) {
    if (preserve(be.id)) continue;
    const host = nodeById.get(be.hostId);
    if (!host?.bounds) continue;
    be.bounds = {
      x: host.bounds.x + host.bounds.width / 2 - be.width / 2,
      y: host.bounds.y + host.bounds.height - be.height / 2,
      width: be.width,
      height: be.height,
    };
  }
}

function shiftGraph(graph: ProcessGraph, ox: number, oy: number): void {
  for (const node of graph.nodes) {
    if (node.bounds) { node.bounds.x += ox; node.bounds.y += oy; }
  }
  for (const be of graph.boundaryEvents) {
    if (be.bounds) { be.bounds.x += ox; be.bounds.y += oy; }
  }
  for (const lane of graph.lanes) {
    if (lane.bounds) { lane.bounds.x += ox; lane.bounds.y += oy; }
  }
  for (const edge of graph.edges) {
    if (edge.points) edge.points = edge.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  }
  for (const ann of graph.annotations) {
    if (ann.bounds) { ann.bounds.x += ox; ann.bounds.y += oy; }
  }
  for (const assoc of graph.associations) {
    if (assoc.points) assoc.points = assoc.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  }
  for (const de of graph.dataElements) {
    if (de.bounds) { de.bounds.x += ox; de.bounds.y += oy; }
  }
  for (const da of graph.dataAssociations) {
    if (da.points) da.points = da.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  }
  for (const group of graph.groups) {
    if (group.bounds) { group.bounds.x += ox; group.bounds.y += oy; }
  }
}

function shiftGraphDeep(graph: ProcessGraph, ox: number, oy: number): void {
  shiftGraph(graph, ox, oy);
  for (const node of graph.nodes) {
    if (node.subGraph) shiftGraphDeep(node.subGraph, ox, oy);
  }
}

function applySubgraphOffsets(graph: ProcessGraph): void {
  for (const node of graph.nodes) {
    if (!node.subGraph || !node.bounds) continue;
    const ox = node.bounds.x + SUBPROCESS_PADDING;
    const oy = node.bounds.y + SUBPROCESS_PADDING;
    shiftGraph(node.subGraph, ox, oy);
    applySubgraphOffsets(node.subGraph);
  }
}

const GROUP_PADDING = 20;

function placeGroups(graph: ProcessGraph, preserve: (id: string) => boolean = () => false): void {
  const boundsById = new Map<string, Bounds>();
  for (const node of graph.nodes) { if (node.bounds) boundsById.set(node.id, node.bounds); }

  for (const group of graph.groups) {
    if (preserve(group.id)) continue;
    const memberBounds = (group.memberNodeIds.length
      ? group.memberNodeIds.map((id) => boundsById.get(id)).filter((b): b is Bounds => !!b)
      : [...boundsById.values()]);
    if (!memberBounds.length) continue;
    const left = Math.min(...memberBounds.map((b) => b.x)) - GROUP_PADDING;
    const top = Math.min(...memberBounds.map((b) => b.y)) - GROUP_PADDING;
    const right = Math.max(...memberBounds.map((b) => b.x + b.width)) + GROUP_PADDING;
    const bottom = Math.max(...memberBounds.map((b) => b.y + b.height)) + GROUP_PADDING;
    group.bounds = { x: left, y: top, width: right - left, height: bottom - top };
  }
}

function transposePoint(p: Point): Point {
  return { x: p.y, y: p.x };
}

function transposeGraph(graph: ProcessGraph): void {
  for (const node of graph.nodes) {
    if (node.bounds) node.bounds = transposeBounds(node.bounds);
    if (node.subGraph) transposeGraph(node.subGraph);
  }
  for (const be of graph.boundaryEvents) { if (be.bounds) be.bounds = transposeBounds(be.bounds); }
  for (const lane of graph.lanes) { if (lane.bounds) lane.bounds = transposeBounds(lane.bounds); }
  if (graph.participant?.bounds) graph.participant.bounds = transposeBounds(graph.participant.bounds);
  for (const ann of graph.annotations) { if (ann.bounds) ann.bounds = transposeBounds(ann.bounds); }
  for (const de of graph.dataElements) { if (de.bounds) de.bounds = transposeBounds(de.bounds); }
  for (const group of graph.groups) { if (group.bounds) group.bounds = transposeBounds(group.bounds); }
  for (const assoc of graph.associations) {
    if (assoc.points) assoc.points = assoc.points.map(transposePoint);
  }
  for (const da of graph.dataAssociations) {
    if (da.points) da.points = da.points.map(transposePoint);
  }
  [graph.width, graph.height] = [graph.height, graph.width];
}

function applyTopToBottom(model: LayoutModel): void {
  for (const graph of model.graphs) transposeGraph(graph);
  for (const participant of model.blackBoxParticipants) {
    if (participant.bounds) participant.bounds = transposeBounds(participant.bounds);
  }
}

function placeBoundaryEventsDeep(graph: ProcessGraph): void {
  for (const node of graph.nodes) {
    if (node.subGraph) { placeBoundaryEvents(node.subGraph); placeBoundaryEventsDeep(node.subGraph); }
  }
}

function routeDeep(graph: ProcessGraph, spacing: Spacing): void {
  routeSequenceEdges(graph);
  placeAnnotations(graph, spacing);
  placeDataElements(graph, spacing);
  routeAssociations(graph);
  routeDataAssociations(graph);
  placeGroups(graph);
  for (const node of graph.nodes) {
    if (node.subGraph) routeDeep(node.subGraph, spacing);
  }
}

function refreshAfterBoundsRestore(
  graph: ProcessGraph,
  spacing: Spacing,
  preserve: (id: string) => boolean,
): void {
  placeBoundaryEvents(graph, preserve);
  placeAnnotations(graph, spacing, preserve);
  placeDataElements(graph, spacing, preserve);
  placeGroups(graph, preserve);
  routeSequenceEdges(graph);
  routeAssociations(graph);
  routeDataAssociations(graph);
  for (const node of graph.nodes) {
    if (node.subGraph) refreshAfterBoundsRestore(node.subGraph, spacing, preserve);
  }
}

export function layoutModel(model: LayoutModel, options: LayoutOptions): void {
  const spacing = SPACING[options.spacing ?? 'normal'];

  type GraphItem = { kind: 'graph'; graph: ProcessGraph; order: number };
  type BlackBoxItem = { kind: 'blackbox'; participant: LayoutParticipant; order: number };
  const items: Array<GraphItem | BlackBoxItem> = [
    ...model.graphs.map((graph) => ({ kind: 'graph' as const, graph, order: graph.participantOrder })),
    ...model.blackBoxParticipants.map((participant) => ({
      kind: 'blackbox' as const,
      participant,
      order: participant.participantOrder,
    })),
  ];
  items.sort((a, b) => {
    const diff = a.order - b.order;
    if (diff !== 0) return diff;
    const aId = a.kind === 'graph' ? (a.graph.participant?.id ?? '') : a.participant.id;
    const bId = b.kind === 'graph' ? (b.graph.participant?.id ?? '') : b.participant.id;
    return aId.localeCompare(bId);
  });

  // First pass: compute widths of process graphs
  let maxWidth = 0;
  for (const item of items) {
    if (item.kind === 'graph') {
      layoutGraph(item.graph, 50, 0, spacing);
      if (item.graph.width > maxWidth) maxWidth = item.graph.width;
    }
  }
  const blackBoxWidth = Math.max(maxWidth, 300);

  // Second pass: stack at correct y offsets
  let y = 50;
  for (const item of items) {
    if (item.kind === 'graph') {
      layoutGraph(item.graph, 50, y, spacing);
      y += item.graph.height + spacing.poolGap;
    } else {
      item.participant.bounds = { x: 50, y, width: blackBoxWidth, height: BLACK_BOX_PARTICIPANT_HEIGHT };
      y += BLACK_BOX_PARTICIPANT_HEIGHT + spacing.poolGap;
    }
  }

  for (const graph of model.graphs) placeBoundaryEvents(graph);
  for (const graph of model.graphs) applySubgraphOffsets(graph);
  for (const graph of model.graphs) placeBoundaryEventsDeep(graph);
  if (options.direction === 'top-to-bottom') applyTopToBottom(model);
  for (const graph of model.graphs) routeDeep(graph, spacing);
  routeMessageEdges(model);
}

type ExistingDi = Map<string, { bounds?: Bounds; points?: Point[] }>;

function applyGraphDi(
  graph: ProcessGraph,
  di: ExistingDi,
  preserve: (id: string) => boolean,
): void {
  for (const node of graph.nodes) {
    const entry = di.get(node.id);
    if (entry?.bounds && preserve(node.id)) {
      const previous = node.bounds;
      node.bounds = entry.bounds;
      if (node.subGraph && previous) {
        shiftGraphDeep(node.subGraph, entry.bounds.x - previous.x, entry.bounds.y - previous.y);
      }
    }
    if (node.subGraph) applyGraphDi(node.subGraph, di, preserve);
  }
  for (const be of graph.boundaryEvents) {
    const entry = di.get(be.id);
    if (entry?.bounds && preserve(be.id)) be.bounds = entry.bounds;
  }
  for (const lane of graph.lanes) {
    const entry = di.get(lane.id);
    if (entry?.bounds && preserve(lane.id)) lane.bounds = entry.bounds;
  }
  if (graph.participant) {
    const entry = di.get(graph.participant.id);
    if (entry?.bounds && preserve(graph.participant.id)) graph.participant.bounds = entry.bounds;
  }
  for (const ann of graph.annotations) {
    const entry = di.get(ann.id);
    if (entry?.bounds && preserve(ann.id)) ann.bounds = entry.bounds;
  }
  for (const de of graph.dataElements) {
    const entry = di.get(de.id);
    if (entry?.bounds && preserve(de.id)) de.bounds = entry.bounds;
  }
  for (const group of graph.groups) {
    const entry = di.get(group.id);
    if (entry?.bounds && preserve(group.id)) group.bounds = entry.bounds;
  }
}

function restoreGraphEdges(graph: ProcessGraph, di: ExistingDi, preserveEdge: (id: string) => boolean): void {
  for (const edge of [...graph.edges, ...graph.associations, ...graph.dataAssociations]) {
    const entry = di.get(edge.id);
    if (entry?.points && preserveEdge(edge.id)) edge.points = entry.points;
  }
  for (const node of graph.nodes) {
    if (node.subGraph) restoreGraphEdges(node.subGraph, di, preserveEdge);
  }
}

export function applyDiPolicy(model: LayoutModel, di: ExistingDi, options: LayoutOptions): void {
  const policy = options.diPolicy ?? 'replace';
  const pins = new Set(options.pins ?? []);
  const hasPins = pins.size > 0;
  if (policy === 'replace' && !hasPins) return;

  const spacing = SPACING[options.spacing ?? 'normal'];

  function preserve(id: string): boolean {
    if (pins.has(id)) return true;
    if (policy === 'replace') return false;
    const entry = di.get(id);
    if (!entry?.bounds) return false;
    if (policy === 'repair') return entry.bounds.width > 0 && entry.bounds.height > 0;
    return true; // complete
  }

  function preserveEdge(id: string): boolean {
    if (pins.has(id)) return true;
    if (policy !== 'complete') return false;
    return !!di.get(id)?.points;
  }

  const restoreEdges = policy === 'complete' || hasPins;
  for (const graph of model.graphs) applyGraphDi(graph, di, preserve);
  for (const participant of model.blackBoxParticipants) {
    const entry = di.get(participant.id);
    if (entry?.bounds && preserve(participant.id)) participant.bounds = entry.bounds;
  }

  for (const graph of model.graphs) refreshAfterBoundsRestore(graph, spacing, preserve);
  routeMessageEdges(model);

  if (restoreEdges) {
    for (const graph of model.graphs) restoreGraphEdges(graph, di, preserveEdge);
    for (const edge of model.messageEdges) {
      const entry = di.get(edge.id);
      if (entry?.points && preserveEdge(edge.id)) edge.points = entry.points;
    }
  }
}
