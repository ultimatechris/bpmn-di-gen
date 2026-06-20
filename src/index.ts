import BpmnModdle from 'bpmn-moddle';
import { analyzeDefinitions } from './analyze.js';
import { writeDiagramInterchange } from './di.js';
import { BpmnLayoutError } from './errors.js';
import { applyDiPolicy, layoutModel } from './layout.js';
import type { ProcessGraph } from './model.js';
import { readExistingDi } from './read-di.js';
import type { LayoutMetrics, LayoutOptions, LayoutResult } from './types.js';
import { validateGeneratedDefinitions } from './validate.js';

export type {
  Diagnostic,
  DiPolicy,
  LayoutDirection,
  LayoutMetrics,
  LayoutOptions,
  LayoutResult,
  LayoutSpacing,
} from './types.js';
export { BpmnLayoutError } from './errors.js';

function metrics(model: ReturnType<typeof analyzeDefinitions>): LayoutMetrics {
  const graphs: ProcessGraph[] = [];
  const collectGraphs = (graph: ProcessGraph): void => {
    graphs.push(graph);
    for (const node of graph.nodes) {
      if (node.subGraph) collectGraphs(node.subGraph);
    }
  };
  model.graphs.forEach(collectGraphs);
  const bounds = [] as Array<{ x: number; y: number; width: number; height: number }>;
  for (const graph of graphs) {
    for (const node of graph.nodes) { if (node.bounds) bounds.push(node.bounds); }
    for (const event of graph.boundaryEvents) { if (event.bounds) bounds.push(event.bounds); }
    for (const annotation of graph.annotations) { if (annotation.bounds) bounds.push(annotation.bounds); }
    for (const element of graph.dataElements) { if (element.bounds) bounds.push(element.bounds); }
    for (const group of graph.groups) { if (group.bounds) bounds.push(group.bounds); }
    for (const lane of graph.lanes) { if (lane.bounds) bounds.push(lane.bounds); }
    if (graph.participant?.bounds) bounds.push(graph.participant.bounds);
  }
  for (const participant of model.blackBoxParticipants) {
    if (participant.bounds) bounds.push(participant.bounds);
  }
  if (!bounds.length) {
    return {
      shapeCount: 0,
      edgeCount: 0,
      laneCount: 0,
      participantCount: 0,
      width: 0,
      height: 0,
      backwardEdgeCount: 0,
    };
  }
  const extent = bounds.reduce((result, item) => ({
    minX: Math.min(result.minX, item.x),
    minY: Math.min(result.minY, item.y),
    maxX: Math.max(result.maxX, item.x + item.width),
    maxY: Math.max(result.maxY, item.y + item.height),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
  return {
    shapeCount: bounds.length,
    edgeCount: graphs.reduce(
      (total, graph) => total
        + graph.edges.filter((edge) => edge.points).length
        + graph.associations.filter((association) => association.points).length
        + graph.dataAssociations.filter((association) => association.points).length,
      0,
    )
      + model.messageEdges.filter((edge) => edge.points).length,
    laneCount: graphs.reduce((total, graph) => total + graph.lanes.length, 0),
    participantCount: model.graphs.filter((graph) => graph.participant).length
      + model.blackBoxParticipants.length,
    width: extent.maxX - extent.minX,
    height: extent.maxY - extent.minY,
    backwardEdgeCount: graphs.reduce(
      (total, graph) => total + graph.edges.filter((edge) => edge.backward).length,
      0,
    ),
  };
}

function validateOptions(options: LayoutOptions): void {
  if (options.diPolicy && !['replace', 'complete', 'repair'].includes(options.diPolicy)) {
    throw new BpmnLayoutError(`Unsupported DI policy: ${options.diPolicy}`);
  }
  if (options.direction && !['left-to-right', 'top-to-bottom'].includes(options.direction)) {
    throw new BpmnLayoutError(`Unsupported layout direction: ${options.direction}`);
  }
  if (options.spacing && !['compact', 'normal', 'spacious'].includes(options.spacing)) {
    throw new BpmnLayoutError(`Unsupported spacing: ${options.spacing}`);
  }
  if (options.pins !== undefined
    && (!Array.isArray(options.pins)
      || options.pins.some((id) => typeof id !== 'string' || !id.trim()))) {
    throw new BpmnLayoutError('The pins option must be an array of non-empty element IDs.');
  }
}

/**
 * Generates BPMN Diagram Interchange shapes and edges for a BPMN 2.0 document.
 *
 * @param xml BPMN 2.0 XML to lay out.
 * @param options Layout direction, spacing, DI policy, and optional pinned element IDs.
 * @returns The generated XML together with layout diagnostics and metrics.
 * @throws {BpmnLayoutError} If the input, options, or generated BPMN document is invalid.
 */
export async function layoutBpmn(xml: string, options: LayoutOptions = {}): Promise<LayoutResult> {
  validateOptions(options);
  if (typeof xml !== 'string' || !xml.trim()) throw new BpmnLayoutError('BPMN XML must be a non-empty string.');
  const moddle = new BpmnModdle();
  let definitions: any;
  let warnings: any[] = [];
  try {
    const parsed = await moddle.fromXML(xml);
    definitions = parsed.rootElement;
    warnings = parsed.warnings ?? [];
  } catch (error) {
    throw new BpmnLayoutError(`Unable to parse BPMN XML: ${(error as Error).message}`, [], { cause: error });
  }

  const policy = options.diPolicy ?? 'replace';
  const existingDi = (policy !== 'replace' || (options.pins?.length ?? 0) > 0)
    ? readExistingDi(definitions)
    : new Map();

  const model = analyzeDefinitions(definitions);
  for (const warning of warnings) {
    model.diagnostics.push({
      severity: 'warning',
      code: 'BPMN_PARSE_WARNING',
      message: warning.message ?? String(warning),
    });
  }
  layoutModel(model, options);
  applyDiPolicy(model, existingDi, options);
  const resultMetrics = metrics(model);
  writeDiagramInterchange(moddle, model, options);
  const { xml: outputXml } = await moddle.toXML(definitions, { format: true, preamble: true });

  const verificationModdle = new BpmnModdle();
  const reparsed = await verificationModdle.fromXML(outputXml);
  validateGeneratedDefinitions(reparsed.rootElement);
  return { xml: outputXml, diagnostics: model.diagnostics, metrics: resultMetrics };
}
