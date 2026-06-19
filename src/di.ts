import type BpmnModdle from 'bpmn-moddle';
import type { LayoutModel } from './model.js';
import type { Bounds, LayoutOptions, Point } from './types.js';

function collectIds(value: any, ids: Set<string>, visited: Set<any>): void {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (typeof value.id === 'string') ids.add(value.id);
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$') || key === 'di') continue;
    if (Array.isArray(child)) child.forEach((item) => collectIds(item, ids, visited));
    else collectIds(child, ids, visited);
  }
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}_${suffix++}`;
  used.add(id);
  return id;
}

function dcBounds(moddle: BpmnModdle, bounds: Bounds): any {
  return moddle.create('dc:Bounds', { ...bounds });
}

function waypoint(moddle: BpmnModdle, point: Point): any {
  return moddle.create('dc:Point', { ...point });
}

export function writeDiagramInterchange(moddle: BpmnModdle, model: LayoutModel, options: LayoutOptions): void {
  const used = new Set<string>();
  collectIds(model.definitions, used, new Set());
  const planeElements: any[] = [];
  const diagram = moddle.create('bpmndi:BPMNDiagram', {
    id: uniqueId('BPMNDiagram_AutoLayout', used),
  });
  const plane = moddle.create('bpmndi:BPMNPlane', {
    id: uniqueId('BPMNPlane_AutoLayout', used),
    bpmnElement: model.planeElement,
    planeElement: planeElements,
  });
  diagram.plane = plane;

  const addShape = (element: any, bounds: Bounds, extra: Record<string, unknown> = {}): void => {
    planeElements.push(moddle.create('bpmndi:BPMNShape', {
      id: uniqueId(`${element.id}_di`, used),
      bpmnElement: element,
      bounds: dcBounds(moddle, bounds),
      ...extra,
    }));
  };
  const addEdge = (element: any, points: Point[]): void => {
    planeElements.push(moddle.create('bpmndi:BPMNEdge', {
      id: uniqueId(`${element.id}_di`, used),
      bpmnElement: element,
      waypoint: points.map((point) => waypoint(moddle, point)),
    }));
  };

  for (const graph of model.graphs) {
    const isHorizontal = options.direction !== 'top-to-bottom';
    if (graph.participant?.bounds) addShape(graph.participant.element, graph.participant.bounds, { isHorizontal });
    for (const lane of graph.lanes) addShape(lane.element, lane.bounds!, { isHorizontal });
    for (const node of graph.nodes) {
      const extra = node.type.endsWith('SubProcess') ? { isExpanded: false } : {};
      addShape(node.element, node.bounds!, extra);
    }
    for (const be of graph.boundaryEvents) {
      if (be.bounds) addShape(be.element, be.bounds, { cancelActivity: true });
    }
    for (const edge of graph.edges) {
      if (edge.points) addEdge(edge.element, edge.points);
    }
    for (const ann of graph.annotations) {
      if (ann.bounds) addShape(ann.element, ann.bounds);
    }
    for (const assoc of graph.associations) {
      if (assoc.points) addEdge(assoc.element, assoc.points);
    }
    for (const de of graph.dataElements) {
      if (de.bounds) addShape(de.element, de.bounds);
    }
    for (const da of graph.dataAssociations) {
      if (da.points) addEdge(da.element, da.points);
    }
    for (const group of graph.groups) {
      if (group.bounds) addShape(group.element, group.bounds);
    }
  }
  for (const edge of model.messageEdges) {
    if (edge.points) addEdge(edge.element, edge.points);
  }

  const isHorizontal = options.direction !== 'top-to-bottom';
  for (const participant of model.blackBoxParticipants) {
    if (participant.bounds) addShape(participant.element, participant.bounds, { isHorizontal });
  }

  model.definitions.diagrams = [diagram];
}
