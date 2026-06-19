import { BpmnLayoutError } from './errors.js';
import type {
  LayoutAnnotation,
  LayoutAssociation,
  LayoutBoundaryEvent,
  LayoutEdge,
  LayoutLane,
  LayoutModel,
  LayoutNode,
  LayoutParticipant,
  ProcessGraph,
} from './model.js';
import type { Diagnostic } from './types.js';

const FLOW_NODE_TYPES = [
  'Event',
  'Task',
  'Activity',
  'Gateway',
  'SubProcess',
  'CallActivity',
];

function isType(element: any, suffix: string): boolean {
  return typeof element?.$type === 'string' && element.$type.endsWith(suffix);
}

function isFlowNode(element: any): boolean {
  if (!element?.id || isType(element, 'BoundaryEvent')) return false;
  return FLOW_NODE_TYPES.some((type) => isType(element, type));
}

function dimensions(type: string): { width: number; height: number } {
  if (type.endsWith('Event')) return { width: 36, height: 36 };
  if (type.endsWith('Gateway')) return { width: 50, height: 50 };
  return { width: 100, height: 80 };
}

function collectLanes(
  laneSets: any[] | undefined,
  parentId: string | undefined,
  depth: number,
  lanes: LayoutLane[],
): void {
  for (const laneSet of laneSets ?? []) {
    for (const lane of laneSet.lanes ?? []) {
      const item: LayoutLane = {
        id: lane.id,
        element: lane,
        parentId,
        childIds: [],
        nodeIds: (lane.flowNodeRef ?? []).map((node: any) => node.id),
        depth,
      };
      lanes.push(item);
      const childStart = lanes.length;
      collectLanes(lane.childLaneSet ? [lane.childLaneSet] : [], lane.id, depth + 1, lanes);
      item.childIds = lanes.slice(childStart).filter((child) => child.parentId === lane.id).map((child) => child.id);
    }
  }
}

function assignLaneMembership(
  nodes: LayoutNode[],
  lanes: LayoutLane[],
  diagnostics: Diagnostic[],
): void {
  const byNode = new Map<string, LayoutLane[]>();
  for (const lane of lanes) {
    for (const nodeId of lane.nodeIds) {
      const memberships = byNode.get(nodeId) ?? [];
      memberships.push(lane);
      byNode.set(nodeId, memberships);
    }
  }

  for (const node of nodes) {
    const memberships = (byNode.get(node.id) ?? []).sort((a, b) => b.depth - a.depth || a.id.localeCompare(b.id));
    if (!memberships.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNASSIGNED_LANE_NODE',
        message: `Flow node ${node.id} is not assigned to a lane; it will use the first leaf lane.`,
        elementId: node.id,
      });
      continue;
    }
    const deepest = memberships[0];
    const peers = memberships.filter((lane) => lane.depth === deepest.depth && lane.id !== deepest.id);
    if (peers.length) {
      diagnostics.push({
        severity: 'error',
        code: 'AMBIGUOUS_LANE_MEMBERSHIP',
        message: `Flow node ${node.id} belongs to multiple lanes at the same depth.`,
        elementId: node.id,
      });
    }
    node.laneId = deepest.id;
  }
}

function buildGraph(process: any, participant: LayoutParticipant | undefined, diagnostics: Diagnostic[]): ProcessGraph {
  const flowElements = process.flowElements ?? [];

  // Collect boundary events first
  const boundaryEvents: LayoutBoundaryEvent[] = [];
  for (const element of flowElements) {
    if (!isType(element, 'BoundaryEvent')) continue;
    const hostId = element.attachedToRef?.id;
    if (!hostId) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNSUPPORTED_ELEMENT',
        message: `BoundaryEvent ${element.id} has no attachedToRef and will not be laid out.`,
        elementId: element.id,
      });
      continue;
    }
    boundaryEvents.push({ id: element.id, type: element.$type, element, hostId, width: 36, height: 36 });
  }
  const boundaryEventIds = new Set(boundaryEvents.map((be) => be.id));

  // Warn about remaining unsupported elements
  for (const element of flowElements) {
    if (isType(element, 'BoundaryEvent')) continue;
    if (!isFlowNode(element) && !isType(element, 'SequenceFlow')) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNSUPPORTED_ELEMENT',
        message: `${element.$type ?? 'BPMN element'} ${element.id ?? ''} is preserved but is not laid out.`.trim(),
        elementId: element.id,
      });
    }
  }
  const annotations: LayoutAnnotation[] = [];
  const associations: LayoutAssociation[] = [];
  for (const artifact of process.artifacts ?? []) {
    if (isType(artifact, 'TextAnnotation')) {
      annotations.push({ id: artifact.id, element: artifact, width: 120, height: 60 });
    } else if (isType(artifact, 'Association')) {
      const sourceId = artifact.sourceRef?.id;
      const targetId = artifact.targetRef?.id;
      if (sourceId && targetId) {
        associations.push({ id: artifact.id, element: artifact, sourceId, targetId });
      } else {
        diagnostics.push({
          severity: 'warning',
          code: 'UNSUPPORTED_ELEMENT',
          message: `Association ${artifact.id ?? ''} has an unresolved endpoint.`,
          elementId: artifact.id,
        });
      }
    } else {
      diagnostics.push({
        severity: 'warning',
        code: 'UNSUPPORTED_ELEMENT',
        message: `${artifact.$type ?? 'BPMN artifact'} ${artifact.id ?? ''} is preserved but is not laid out.`.trim(),
        elementId: artifact.id,
      });
    }
  }
  // Wire connectedNodeId for annotations referenced by associations
  for (const assoc of associations) {
    const ann = annotations.find((a) => a.id === assoc.targetId);
    if (ann && !ann.connectedNodeId) ann.connectedNodeId = assoc.sourceId;
    const ann2 = annotations.find((a) => a.id === assoc.sourceId);
    if (ann2 && !ann2.connectedNodeId) ann2.connectedNodeId = assoc.targetId;
  }

  const nodes: LayoutNode[] = flowElements.filter(isFlowNode).map((element: any, order: number) => {
    const size = dimensions(element.$type);
    return { id: element.id, type: element.$type, element, width: size.width, height: size.height, rank: 0, order };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const validEndpoints = new Set([...nodeIds, ...boundaryEventIds]);

  const edges: LayoutEdge[] = flowElements
    .filter((element: any) => isType(element, 'SequenceFlow'))
    .flatMap((element: any) => {
      const sourceId = element.sourceRef?.id;
      const targetId = element.targetRef?.id;
      if (!sourceId || !targetId || !validEndpoints.has(sourceId) || !validEndpoints.has(targetId)) {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_SEQUENCE_FLOW',
          message: `Sequence flow ${element.id} has an unresolved or unsupported endpoint.`,
          elementId: element.id,
        });
        return [];
      }
      return [{ id: element.id, type: 'sequence' as const, element, sourceId, targetId, backward: false }];
    });

  const lanes: LayoutLane[] = [];
  collectLanes(process.laneSets, undefined, 0, lanes);
  if (lanes.length) assignLaneMembership(nodes, lanes, diagnostics);
  const incoming = new Set(edges.filter((e) => nodeIds.has(e.targetId)).map((e) => e.targetId));
  const roots = nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);
  return { process, participant, nodes, edges, lanes, roots, width: 0, height: 0, participantOrder: 0, boundaryEvents, annotations, associations };
}

export function analyzeDefinitions(definitions: any): LayoutModel {
  const diagnostics: Diagnostic[] = [];
  const roots = definitions.rootElements ?? [];
  const processes = roots.filter((element: any) => isType(element, 'Process'));
  const collaboration = roots.find((element: any) => isType(element, 'Collaboration'));
  const graphs: ProcessGraph[] = [];
  const blackBoxParticipants: LayoutParticipant[] = [];

  if (collaboration) {
    const collaborationParticipants: any[] = collaboration.participants ?? [];
    collaborationParticipants.forEach((element: any, order: number) => {
      const participant: LayoutParticipant = {
        id: element.id,
        element,
        processId: element.processRef?.id,
        participantOrder: order,
      };
      if (!participant.processId) {
        blackBoxParticipants.push(participant);
        return;
      }
      const process = processes.find((item: any) => item.id === participant.processId);
      if (!process) {
        diagnostics.push({
          severity: 'error',
          code: 'UNRESOLVED_PARTICIPANT_PROCESS',
          message: `Participant ${participant.id} references a missing process.`,
          elementId: participant.id,
        });
        return;
      }
      const graph = buildGraph(process, participant, diagnostics);
      graph.participantOrder = order;
      graphs.push(graph);
    });
  } else {
    for (const process of processes) graphs.push(buildGraph(process, undefined, diagnostics));
  }

  if (!graphs.length && !blackBoxParticipants.length) {
    throw new BpmnLayoutError('No layoutable BPMN process was found.', diagnostics);
  }

  const messageEdges: LayoutEdge[] = (collaboration?.messageFlows ?? []).flatMap((element: any) => {
    const sourceId = element.sourceRef?.id;
    const targetId = element.targetRef?.id;
    if (!sourceId || !targetId) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_MESSAGE_FLOW',
        message: `Message flow ${element.id} has an unresolved endpoint.`,
        elementId: element.id,
      });
      return [];
    }
    return [{
      id: element.id,
      type: 'message' as const,
      element,
      sourceId,
      targetId,
      backward: false,
    }];
  });

  const planeElement = collaboration ?? graphs[0]?.process;
  return { definitions, planeElement, collaboration, graphs, messageEdges, diagnostics, blackBoxParticipants };
}
