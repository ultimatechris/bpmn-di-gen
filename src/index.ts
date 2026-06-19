import BpmnModdle from 'bpmn-moddle';
import { analyzeDefinitions } from './analyze.js';
import { writeDiagramInterchange } from './di.js';
import { BpmnLayoutError } from './errors.js';
import { layoutModel } from './layout.js';
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
  const bounds = [
    ...model.graphs.flatMap((graph) => [
      ...graph.nodes.map((node) => node.bounds!),
      ...graph.lanes.map((lane) => lane.bounds!),
      ...(graph.participant?.bounds ? [graph.participant.bounds] : []),
    ]),
    ...model.blackBoxParticipants.filter((p) => p.bounds).map((p) => p.bounds!),
  ];
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
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  return {
    shapeCount: bounds.length,
    edgeCount: model.graphs.reduce((total, graph) => total + graph.edges.length, 0)
      + model.messageEdges.filter((edge) => edge.points).length,
    laneCount: model.graphs.reduce((total, graph) => total + graph.lanes.length, 0),
    participantCount: model.graphs.filter((graph) => graph.participant).length
      + model.blackBoxParticipants.length,
    width: maxX - minX,
    height: maxY - minY,
    backwardEdgeCount: model.graphs.reduce(
      (total, graph) => total + graph.edges.filter((edge) => edge.backward).length,
      0,
    ),
  };
}

function validateOptions(options: LayoutOptions): void {
  if (options.diPolicy && options.diPolicy !== 'replace') {
    throw new BpmnLayoutError(`Unsupported DI policy: ${options.diPolicy}`);
  }
  if (options.direction && !['left-to-right', 'top-to-bottom'].includes(options.direction)) {
    throw new BpmnLayoutError(`Unsupported layout direction: ${options.direction}`);
  }
  if (options.spacing && !['compact', 'normal', 'spacious'].includes(options.spacing)) {
    throw new BpmnLayoutError(`Unsupported spacing: ${options.spacing}`);
  }
}

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
    throw new BpmnLayoutError(`Unable to parse BPMN XML: ${(error as Error).message}`);
  }

  const model = analyzeDefinitions(definitions);
  for (const warning of warnings) {
    model.diagnostics.push({
      severity: 'warning',
      code: 'BPMN_PARSE_WARNING',
      message: warning.message ?? String(warning),
    });
  }
  layoutModel(model, options);
  const resultMetrics = metrics(model);
  writeDiagramInterchange(moddle, model, options);
  const { xml: outputXml } = await moddle.toXML(definitions, { format: true, preamble: true });

  const verificationModdle = new BpmnModdle();
  const reparsed = await verificationModdle.fromXML(outputXml);
  validateGeneratedDefinitions(reparsed.rootElement);
  return { xml: outputXml, diagnostics: model.diagnostics, metrics: resultMetrics };
}
