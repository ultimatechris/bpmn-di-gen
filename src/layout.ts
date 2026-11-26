import type { LayoutBoundaryEvent, LayoutModel, LayoutLane, LayoutNode, LayoutParticipant, ProcessGraph } from './model.js';
import type { Bounds, LayoutOptions, Point } from './types.js';
import { assignEdgePorts, outsideStub } from './ports.js';
import { assignRanks } from './rank.js';
import type { ExistingDiElement } from './read-di.js';
import { routeOrthogonal, type OccupiedSegment } from './router.js';

interface Spacing {
  rankGap: number;
  nodeGap: number;
  paddingX: number;
  paddingY: number;
  laneMinHeight: number;
  poolGap: number;
  routingClearance: number;
  edgeSeparation: number;
}

const SPACING: Record<NonNullable<LayoutOptions['spacing']>, Spacing> = {
  compact: {
    rankGap: 70, nodeGap: 25, paddingX: 35, paddingY: 25, laneMinHeight: 110, poolGap: 50,
    routingClearance: 8, edgeSeparation: 8,
  },
  normal: {
    rankGap: 110, nodeGap: 40, paddingX: 55, paddingY: 35, laneMinHeight: 140, poolGap: 70,
    routingClearance: 10, edgeSeparation: 10,
  },
  spacious: {
    rankGap: 160, nodeGap: 60, paddingX: 80, paddingY: 50, laneMinHeight: 180, poolGap: 100,
    routingClearance: 12, edgeSeparation: 12,
  },
};

const POOL_HEADER = 30;
const LANE_HEADER = 30;
const BLACK_BOX_PARTICIPANT_HEIGHT = 120;
const SUBPROCESS_PADDING = 40;
const BOUNDARY_EVENT_GAP = 4;

function boundaryEventsByHost(graph: ProcessGraph): Map<string, LayoutBoundaryEvent[]> {
  const byHost = new Map<string, LayoutBoundaryEvent[]>();
  for (const event of graph.boundaryEvents) {
    const attached = byHost.get(event.hostId) ?? [];
    attached.push(event);
    byHost.set(event.hostId, attached);
  }
  return byHost;
}

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
  const boundaryEvents = boundaryEventsByHost(graph);
  for (const node of graph.nodes) {
    const attached = boundaryEvents.get(node.id);
    if (attached && attached.length > 1) {
      const requiredWidth = attached.reduce((width, event) => width + event.width + BOUNDARY_EVENT_GAP, 0);
      node.width = Math.max(node.width, requiredWidth - BOUNDARY_EVENT_GAP);
    }
  }
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
    const top = children.reduce((minimum, child) => Math.min(minimum, child.bounds!.y), Number.POSITIVE_INFINITY);
    const bottom = children.reduce(
      (maximum, child) => Math.max(maximum, child.bounds!.y + child.bounds!.height),
      Number.NEGATIVE_INFINITY,
    );
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

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

function deduplicate(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

function expanded(bounds: Bounds, clearance: number): Bounds {
  return {
    x: bounds.x - clearance,
    y: bounds.y - clearance,
    width: bounds.width + clearance * 2,
    height: bounds.height + clearance * 2,
  };
}

function addOccupiedSegments(edgeId: string, points: Point[], occupied: OccupiedSegment[]): void {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if ((start.x === end.x || start.y === end.y) && (start.x !== end.x || start.y !== end.y)) {
      const duplicate = occupied.some((segment) => segment.edgeId === edgeId
        && ((segment.start.x === start.x && segment.start.y === start.y
          && segment.end.x === end.x && segment.end.y === end.y)
          || (segment.start.x === end.x && segment.start.y === end.y
            && segment.end.x === start.x && segment.end.y === start.y)));
      if (!duplicate) occupied.push({ edgeId, start, end });
    }
  }
}

function horizontalCorridorBlocked(
  sourceId: string,
  targetId: string,
  source: Bounds,
  target: Bounds,
  boundsById: Map<string, Bounds>,
  clearance: number,
): boolean {
  const startX = source.x + source.width;
  const endX = target.x;
  if (endX <= startX) return false;
  const y = centerY(source);
  if (y !== centerY(target)) return false;
  for (const [id, bounds] of boundsById) {
    if (id === sourceId || id === targetId) continue;
    const obstacle = expanded(bounds, clearance);
    if (y > obstacle.y && y < obstacle.y + obstacle.height
      && Math.min(endX, obstacle.x + obstacle.width) - Math.max(startX, obstacle.x) > 0) return true;
  }
  return false;
}

function routeSequenceEdges(graph: ProcessGraph, spacing: Spacing): void {
  const boundsById = new Map<string, Bounds>();
  for (const node of graph.nodes) { if (node.bounds) boundsById.set(node.id, node.bounds); }
  for (const be of graph.boundaryEvents) { if (be.bounds) boundsById.set(be.id, be.bounds); }
  const boundaryHosts = new Map(graph.boundaryEvents.map((event) => [event.id, event.hostId]));
  const boundaryEventIds = new Set(boundaryHosts.keys());
  const ports = assignEdgePorts(graph.edges, boundsById, boundaryEventIds, (edge) => {
    const hostId = boundaryHosts.get(edge.sourceId);
    if (hostId) {
      const event = boundsById.get(edge.sourceId)!;
      const host = boundsById.get(hostId);
      const targetSide = edge.backward ? 'top' : 'left';
      if (host && centerY(event) <= host.y) return ['top', targetSide];
      if (host && centerX(event) <= host.x) return ['left', targetSide];
      if (host && centerX(event) >= host.x + host.width) return ['right', targetSide];
      return ['bottom', targetSide];
    }
    if (edge.backward) return ['top', 'top'];
    const source = boundsById.get(edge.sourceId)!;
    const target = boundsById.get(edge.targetId)!;
    if (horizontalCorridorBlocked(
      edge.sourceId,
      edge.targetId,
      source,
      target,
      boundsById,
      spacing.routingClearance,
    )) return ['top', 'top'];
    return ['right', 'left'];
  });
  const obstacles = [...boundsById.values()].map((bounds) => expanded(bounds, spacing.routingClearance));
  const occupied: OccupiedSegment[] = [];
  const orderedEdges = [...graph.edges].sort((left, right) => {
    const leftBoundary = boundaryEventIds.has(left.sourceId) ? 1 : 0;
    const rightBoundary = boundaryEventIds.has(right.sourceId) ? 1 : 0;
    const category = Number(left.backward) - Number(right.backward) || leftBoundary - rightBoundary;
    if (category !== 0) return category;
    const leftSource = boundsById.get(left.sourceId)!;
    const leftTarget = boundsById.get(left.targetId)!;
    const rightSource = boundsById.get(right.sourceId)!;
    const rightTarget = boundsById.get(right.targetId)!;
    const leftDistance = Math.abs(centerX(leftTarget) - centerX(leftSource)) + Math.abs(centerY(leftTarget) - centerY(leftSource));
    const rightDistance = Math.abs(centerX(rightTarget) - centerX(rightSource)) + Math.abs(centerY(rightTarget) - centerY(rightSource));
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  });

  for (const edge of orderedEdges) {
    const edgePorts = ports.get(edge.id);
    if (!edgePorts) continue;
    const startStub = outsideStub(edgePorts.source, edgePorts.sourceSide, spacing.routingClearance);
    const endStub = outsideStub(edgePorts.target, edgePorts.targetSide, spacing.routingClearance);
    edge.points = routeOrthogonal({
      edgeId: edge.id,
      startPort: edgePorts.source,
      endPort: edgePorts.target,
      startStub,
      endStub,
      obstacles,
      occupiedSegments: occupied,
      options: {
        trackSeparation: spacing.edgeSeparation,
        outerMargin: Math.max(8, spacing.paddingY - spacing.routingClearance),
        bendCost: spacing.edgeSeparation * 3,
        // A crossing is undesirable, but it must not justify a diagram-scale detour.
        // Pricing it at six rank gaps permits a local bypass, not a diagram-scale detour.
        crossingCost: edge.backward ? 20_000 : spacing.rankGap * 6,
        overlapCost: 100_000,
        overlapLengthCost: 200,
      },
    });
    addOccupiedSegments(edge.id, edge.points, occupied);
  }
}

function endpointBounds(model: LayoutModel, id: string): Bounds | undefined {
  function nodeBounds(graph: ProcessGraph): Bounds | undefined {
    const boundaryEvent = graph.boundaryEvents.find((event) => event.id === id);
    if (boundaryEvent?.bounds) return boundaryEvent.bounds;
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

function collectGraphRoutingGeometry(
  graph: ProcessGraph,
  bounds: Bounds[],
  occupied: OccupiedSegment[],
): void {
  for (const node of graph.nodes) {
    if (node.bounds) bounds.push(node.bounds);
    if (node.subGraph) collectGraphRoutingGeometry(node.subGraph, bounds, occupied);
  }
  for (const event of graph.boundaryEvents) { if (event.bounds) bounds.push(event.bounds); }
  for (const annotation of graph.annotations) { if (annotation.bounds) bounds.push(annotation.bounds); }
  for (const dataElement of graph.dataElements) { if (dataElement.bounds) bounds.push(dataElement.bounds); }
  for (const edge of [...graph.edges, ...graph.associations, ...graph.dataAssociations]) {
    if (edge.points) addOccupiedSegments(edge.id, edge.points, occupied);
  }
}

function routeMessageEdges(model: LayoutModel, spacing: Spacing): void {
  const boundsById = new Map<string, Bounds>();
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
    boundsById.set(edge.sourceId, source);
    boundsById.set(edge.targetId, target);
  }

  const participantIds = new Set([
    ...model.graphs.flatMap((graph) => graph.participant ? [graph.participant.id] : []),
    ...model.blackBoxParticipants.map((participant) => participant.id),
  ]);
  const ports = assignEdgePorts(model.messageEdges, boundsById, new Set(), (edge) => {
    const source = boundsById.get(edge.sourceId)!;
    const target = boundsById.get(edge.targetId)!;
    return centerY(target) >= centerY(source) ? ['bottom', 'top'] : ['top', 'bottom'];
  }, participantIds);
  const rawObstacles: Bounds[] = [];
  const occupied: OccupiedSegment[] = [];
  for (const graph of model.graphs) collectGraphRoutingGeometry(graph, rawObstacles, occupied);
  const obstacles = rawObstacles.map((bounds) => expanded(bounds, spacing.routingClearance));
  for (const edge of model.messageEdges) {
    const edgePorts = ports.get(edge.id);
    if (!edgePorts) continue;
    const startStub = outsideStub(edgePorts.source, edgePorts.sourceSide, spacing.routingClearance);
    const endStub = outsideStub(edgePorts.target, edgePorts.targetSide, spacing.routingClearance);
    if (participantIds.has(edge.sourceId)) addOccupiedSegments(edge.id, [edgePorts.source, startStub], occupied);
    if (participantIds.has(edge.targetId)) addOccupiedSegments(edge.id, [endStub, edgePorts.target], occupied);
  }
  const orderedEdges = [...model.messageEdges].sort((left, right) => {
    const leftSource = boundsById.get(left.sourceId);
    const leftTarget = boundsById.get(left.targetId);
    const rightSource = boundsById.get(right.sourceId);
    const rightTarget = boundsById.get(right.targetId);
    if (!leftSource || !leftTarget) return 1;
    if (!rightSource || !rightTarget) return -1;
    const leftDistance = Math.abs(centerX(leftTarget) - centerX(leftSource)) + Math.abs(centerY(leftTarget) - centerY(leftSource));
    const rightDistance = Math.abs(centerX(rightTarget) - centerX(rightSource)) + Math.abs(centerY(rightTarget) - centerY(rightSource));
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  });

  for (const edge of orderedEdges) {
    const edgePorts = ports.get(edge.id);
    if (!edgePorts) continue;
    edge.points = routeOrthogonal({
      edgeId: edge.id,
      startPort: edgePorts.source,
      endPort: edgePorts.target,
      startStub: outsideStub(edgePorts.source, edgePorts.sourceSide, spacing.routingClearance),
      endStub: outsideStub(edgePorts.target, edgePorts.targetSide, spacing.routingClearance),
      obstacles,
      occupiedSegments: occupied,
      options: {
        trackSeparation: spacing.edgeSeparation,
        outerMargin: Math.max(spacing.poolGap / 2, spacing.routingClearance * 2),
        bendCost: spacing.edgeSeparation * 3,
        // Prefer a local crossing over sending a message flow around a whole pool.
        crossingCost: spacing.rankGap * 6,
        overlapCost: 100_000,
        overlapLengthCost: 200,
      },
    });
    addOccupiedSegments(edge.id, edge.points, occupied);
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
    const nodePort = { x: centerX(nodeBounds), y: nodeBounds.y };
    const dataPort = { x: centerX(dataBounds), y: dataBounds.y + dataBounds.height };
    da.points = da.direction === 'input' ? [dataPort, nodePort] : [nodePort, dataPort];
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

function boundarySlots(host: Bounds, event: LayoutBoundaryEvent, count: number): Bounds[] {
  const { width, height } = event;
  const pitchX = width + BOUNDARY_EVENT_GAP;
  const pitchY = height + BOUNDARY_EVENT_GAP;
  const across = Math.min(count, Math.max(1, Math.floor((host.width + BOUNDARY_EVENT_GAP) / pitchX)));
  const down = Math.min(count, Math.max(1, Math.floor((host.height + BOUNDARY_EVENT_GAP) / pitchY)));
  const xs = Array.from({ length: across }, (_, index) => centerX(host) + (index - (across - 1) / 2) * pitchX);
  const ys = Array.from({ length: down }, (_, index) => centerY(host) + (index - (down - 1) / 2) * pitchY);
  return [
    ...xs.map((x) => ({ x, y: host.y + host.height })),
    ...xs.map((x) => ({ x, y: host.y })),
    ...ys.map((y) => ({ x: host.x, y })),
    ...ys.map((y) => ({ x: host.x + host.width, y })),
  ].map(({ x, y }) => ({ x: x - width / 2, y: y - height / 2, width, height }));
}

function placeBoundaryEvents(graph: ProcessGraph, preserve: (id: string) => boolean = () => false): void {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const [hostId, attached] of boundaryEventsByHost(graph)) {
    const host = nodeById.get(hostId)?.bounds;
    if (!host) continue;
    const occupied = attached.flatMap((event) => preserve(event.id) && event.bounds ? [event.bounds] : []);
    const slots = boundarySlots(host, attached[0], attached.length);
    for (const [index, event] of attached.entries()) {
      if (preserve(event.id)) continue;
      const slotIndex = slots.findIndex((slot) => occupied.every((bounds) => !overlaps(slot, bounds)));
      event.bounds = slotIndex >= 0 ? slots.splice(slotIndex, 1)[0] : {
        x: host.x + host.width * (index + 1) / (attached.length + 1) - event.width / 2,
        y: host.y + host.height - event.height / 2,
        width: event.width,
        height: event.height,
      };
      occupied.push(event.bounds);
    }
  }
}

function shiftGraph(graph: ProcessGraph, ox: number, oy: number, preserve?: (id: string) => boolean): void {
  for (const shape of [
    ...graph.nodes, ...graph.boundaryEvents, ...graph.lanes, ...graph.annotations, ...graph.dataElements, ...graph.groups,
  ]) {
    if (shape.bounds && !preserve?.(shape.id)) {
      shape.bounds.x += ox;
      shape.bounds.y += oy;
    }
  }
  for (const edge of [...graph.edges, ...graph.associations, ...graph.dataAssociations]) {
    if (edge.points) edge.points = edge.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  }
}

function shiftGraphDeep(graph: ProcessGraph, ox: number, oy: number, preserve?: (id: string) => boolean): void {
  shiftGraph(graph, ox, oy, preserve);
  for (const node of graph.nodes) {
    if (node.subGraph && !preserve?.(node.id)) shiftGraphDeep(node.subGraph, ox, oy, preserve);
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
    const extent = memberBounds.reduce((result, bounds) => ({
      left: Math.min(result.left, bounds.x),
      top: Math.min(result.top, bounds.y),
      right: Math.max(result.right, bounds.x + bounds.width),
      bottom: Math.max(result.bottom, bounds.y + bounds.height),
    }), {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    });
    const left = extent.left - GROUP_PADDING;
    const top = extent.top - GROUP_PADDING;
    const right = extent.right + GROUP_PADDING;
    const bottom = extent.bottom + GROUP_PADDING;
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
  for (const edge of graph.edges) {
    if (edge.points) edge.points = edge.points.map(transposePoint);
  }
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
  placeAnnotations(graph, spacing);
  placeDataElements(graph, spacing);
  routeSequenceEdges(graph, spacing);
  routeAssociations(graph);
  routeDataAssociations(graph);
  placeGroups(graph);
  for (const node of graph.nodes) {
    if (node.subGraph) routeDeep(node.subGraph, spacing);
  }
}

function horizontalAlternatives(bounds: Bounds, obstacles: Bounds[], gap: number): Bounds[] {
  const row = obstacles.filter((other) => bounds.y < other.y + other.height && other.y < bounds.y + bounds.height)
    .sort((left, right) => left.x - right.x);

  let after = bounds.x;
  for (const other of row) {
    if (after + bounds.width <= other.x) break;
    if (after < other.x + other.width) after = other.x + other.width + gap;
  }
  let before = bounds.x;
  for (const other of row.reverse()) {
    if (before + bounds.width > other.x && before < other.x + other.width) before = other.x - bounds.width - gap;
  }
  return [{ ...bounds, x: after }, { ...bounds, x: before }];
}

function separateRestoredNodes(
  graph: ProcessGraph,
  spacing: Spacing,
  preserve: (id: string) => boolean,
  container?: Bounds,
): void {
  const restored = graph.nodes.flatMap((node) => preserve(node.id) ? [node.bounds!] : []);
  if (!restored.length) return;

  const laneById = new Map(graph.lanes.map((lane) => [lane.id, lane]));
  const leaves = graph.lanes.filter((lane) => !lane.childIds.length);
  for (const node of graph.nodes) {
    const bounds = node.bounds!;
    if (preserve(node.id) || !restored.some((other) => overlaps(bounds, other))) continue;

    const obstacles = graph.nodes.flatMap((other) => other === node ? [] : [other.bounds!]);
    const [after, before] = horizontalAlternatives(bounds, obstacles, spacing.nodeGap);
    const lane = leaves.length ? effectiveLeaf(node, leaves, laneById).bounds : undefined;
    const area = lane ?? container;
    let position = after;
    if (area) {
      const vertical = horizontalAlternatives(transposeBounds(bounds), obstacles.map(transposeBounds), spacing.nodeGap)
        .map(transposeBounds);
      position = [after, before, ...vertical].find((candidate) => (
        candidate.x >= area.x && candidate.x + candidate.width <= area.x + area.width
        && candidate.y >= area.y && candidate.y + candidate.height <= area.y + area.height
      )) ?? after;
    }
    node.bounds = position;
    if (node.subGraph) shiftGraphDeep(node.subGraph, position.x - bounds.x, position.y - bounds.y, preserve);
  }
}

function refreshAfterBoundsRestore(
  graph: ProcessGraph,
  spacing: Spacing,
  preserve: (id: string) => boolean,
  container = graph.participant?.bounds,
): void {
  separateRestoredNodes(graph, spacing, preserve, container);
  placeBoundaryEvents(graph, preserve);
  placeAnnotations(graph, spacing, preserve);
  placeDataElements(graph, spacing, preserve);
  placeGroups(graph, preserve);
  routeSequenceEdges(graph, spacing);
  routeAssociations(graph);
  routeDataAssociations(graph);
  for (const node of graph.nodes) {
    if (node.subGraph) refreshAfterBoundsRestore(node.subGraph, spacing, preserve, node.bounds);
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

  if (!model.collaboration) {
    for (const graph of model.graphs) layoutGraph(graph, 50, 50, spacing);
  } else {
    // First pass: compute widths of process graphs.
    let maxWidth = 0;
    for (const item of items) {
      if (item.kind === 'graph') {
        layoutGraph(item.graph, 50, 0, spacing);
        if (item.graph.width > maxWidth) maxWidth = item.graph.width;
      }
    }
    const blackBoxWidth = Math.max(maxWidth, 300);

    // Second pass: stack collaboration participants at their declared order.
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
  }

  for (const graph of model.graphs) placeBoundaryEvents(graph);
  for (const graph of model.graphs) applySubgraphOffsets(graph);
  for (const graph of model.graphs) placeBoundaryEventsDeep(graph);
  for (const graph of model.graphs) routeDeep(graph, spacing);
  if (options.direction === 'top-to-bottom') applyTopToBottom(model);
  routeMessageEdges(model, spacing);
}

type ExistingDi = ReadonlyMap<string, ExistingDiElement>;

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
    return (policy !== 'replace' || pins.has(id)) && !!di.get(id)?.bounds;
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

  for (const graph of model.graphs) {
    if (options.direction === 'top-to-bottom') transposeGraph(graph);
    refreshAfterBoundsRestore(graph, spacing, preserve);
    if (options.direction === 'top-to-bottom') transposeGraph(graph);
  }
  routeMessageEdges(model, spacing);

  if (restoreEdges) {
    for (const graph of model.graphs) restoreGraphEdges(graph, di, preserveEdge);
    for (const edge of model.messageEdges) {
      const entry = di.get(edge.id);
      if (entry?.points && preserveEdge(edge.id)) edge.points = entry.points;
    }
  }
}
