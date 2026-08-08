import BpmnModdle from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';
import { layoutBpmn } from '../src/index.js';
import { routeOrthogonal } from '../src/router.js';

const BYPASS_PROCESS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_Routing" targetNamespace="http://example.com/routing">
  <bpmn:process id="Process_Routing">
    <bpmn:startEvent id="Start" />
    <bpmn:exclusiveGateway id="Split" />
    <bpmn:task id="OptionalTask" name="Optional work" />
    <bpmn:exclusiveGateway id="Join" />
    <bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="Flow_Start" sourceRef="Start" targetRef="Split" />
    <bpmn:sequenceFlow id="Flow_Work" sourceRef="Split" targetRef="OptionalTask" />
    <bpmn:sequenceFlow id="Flow_WorkDone" sourceRef="OptionalTask" targetRef="Join" />
    <bpmn:sequenceFlow id="Flow_Bypass" sourceRef="Split" targetRef="Join" />
    <bpmn:sequenceFlow id="Flow_End" sourceRef="Join" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

const MESSAGE_OBSTACLE_PROCESS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_MessageRouting" targetNamespace="http://example.com/message-routing">
  <bpmn:collaboration id="Collaboration_MessageRouting">
    <bpmn:participant id="Participant_Process" processRef="Process_MessageRouting" />
    <bpmn:participant id="Participant_Receiver" />
    <bpmn:messageFlow id="Message_ToReceiver" sourceRef="Task_Source" targetRef="Participant_Receiver" />
  </bpmn:collaboration>
  <bpmn:process id="Process_MessageRouting">
    <bpmn:laneSet id="LaneSet_MessageRouting">
      <bpmn:lane id="Lane_Source"><bpmn:flowNodeRef>Task_Source</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Lane_Obstacle"><bpmn:flowNodeRef>Task_Obstacle</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:task id="Task_Source" name="Send message" />
    <bpmn:task id="Task_Obstacle" name="Unrelated work" />
  </bpmn:process>
</bpmn:definitions>`;

interface Point { x: number; y: number }
interface Rect { x: number; y: number; width: number; height: number }

function segments(points: Point[]): Array<{ a: Point; b: Point }> {
  return points.slice(1).map((point, index) => ({ a: points[index], b: point }));
}

function intervalOverlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

function segmentHitsRect(segment: { a: Point; b: Point }, rect: Rect): boolean {
  if (segment.a.y === segment.b.y) {
    return segment.a.y > rect.y && segment.a.y < rect.y + rect.height
      && intervalOverlap(segment.a.x, segment.b.x, rect.x, rect.x + rect.width) > 0;
  }
  if (segment.a.x === segment.b.x) {
    return segment.a.x > rect.x && segment.a.x < rect.x + rect.width
      && intervalOverlap(segment.a.y, segment.b.y, rect.y, rect.y + rect.height) > 0;
  }
  return true;
}

function collinearOverlap(
  first: { a: Point; b: Point },
  second: { a: Point; b: Point },
): number {
  if (first.a.y === first.b.y && second.a.y === second.b.y && first.a.y === second.a.y) {
    return Math.max(0, intervalOverlap(first.a.x, first.b.x, second.a.x, second.b.x));
  }
  if (first.a.x === first.b.x && second.a.x === second.b.x && first.a.x === second.a.x) {
    return Math.max(0, intervalOverlap(first.a.y, first.b.y, second.a.y, second.b.y));
  }
  return 0;
}

function properCrossing(
  first: { a: Point; b: Point },
  second: { a: Point; b: Point },
): boolean {
  const firstHorizontal = first.a.y === first.b.y;
  const secondHorizontal = second.a.y === second.b.y;
  if (firstHorizontal === secondHorizontal) return false;
  const horizontal = firstHorizontal ? first : second;
  const vertical = firstHorizontal ? second : first;
  return vertical.a.x > Math.min(horizontal.a.x, horizontal.b.x)
    && vertical.a.x < Math.max(horizontal.a.x, horizontal.b.x)
    && horizontal.a.y > Math.min(vertical.a.y, vertical.b.y)
    && horizontal.a.y < Math.max(vertical.a.y, vertical.b.y);
}

function routeLength(points: Point[]): number {
  return segments(points).reduce((total, segment) => total
    + Math.abs(segment.b.x - segment.a.x)
    + Math.abs(segment.b.y - segment.a.y), 0);
}

async function routingGeometry(xml: string): Promise<{
  shapes: Map<string, Rect>;
  edges: Array<{ id: string; source: string; target: string; points: Point[] }>;
}> {
  const definitions = (await new BpmnModdle().fromXML(xml)).rootElement;
  const elements = definitions.diagrams[0].plane.planeElement;
  const shapes = new Map(elements
    .filter((element: any) => element.$type === 'bpmndi:BPMNShape'
      && !['bpmn:Participant', 'bpmn:Lane', 'bpmn:Group'].includes(element.bpmnElement.$type))
    .map((element: any) => [element.bpmnElement.id, {
      x: element.bounds.x,
      y: element.bounds.y,
      width: element.bounds.width,
      height: element.bounds.height,
    }]));
  const edges = elements
    .filter((element: any) => element.$type === 'bpmndi:BPMNEdge')
    .map((element: any) => ({
      id: element.bpmnElement.id,
      source: element.bpmnElement.sourceRef.id,
      target: element.bpmnElement.targetRef.id,
      points: element.waypoint.map((point: any) => ({ x: point.x, y: point.y })),
    }));
  return { shapes, edges };
}

function expectCleanRouting(geometry: Awaited<ReturnType<typeof routingGeometry>>): void {
  for (const edge of geometry.edges) {
    for (const [shapeId, bounds] of geometry.shapes) {
      if (shapeId === edge.source || shapeId === edge.target) continue;
      expect(
        segments(edge.points).some((segment) => segmentHitsRect(segment, bounds)),
        `${edge.id} passes through ${shapeId}`,
      ).toBe(false);
    }
  }

  for (let left = 0; left < geometry.edges.length; left += 1) {
    for (let right = left + 1; right < geometry.edges.length; right += 1) {
      const overlap = segments(geometry.edges[left].points).some((first) =>
        segments(geometry.edges[right].points).some((second) => collinearOverlap(first, second) > 0));
      expect(overlap, `${geometry.edges[left].id} overlaps ${geometry.edges[right].id}`).toBe(false);
      const crossing = segments(geometry.edges[left].points).some((first) =>
        segments(geometry.edges[right].points).some((second) => properCrossing(first, second)));
      expect(crossing, `${geometry.edges[left].id} crosses ${geometry.edges[right].id}`).toBe(false);
    }
  }
}

describe('orthogonal routing', () => {
  it('does not take a diagram-scale detour to avoid one crossing', () => {
    const route = routeOrthogonal({
      edgeId: 'new-edge',
      startPort: { x: -10, y: 0 },
      startStub: { x: 0, y: 0 },
      endStub: { x: 100, y: 0 },
      endPort: { x: 110, y: 0 },
      obstacles: [],
      occupiedSegments: [{
        edgeId: 'existing-edge',
        start: { x: 50, y: -500 },
        end: { x: 50, y: 500 },
      }],
      options: { crossingCost: 220, bendCost: 30 },
    });

    expect(routeLength(route)).toBeLessThanOrEqual(220);
  });

  it('routes a bypass around the task between its gateways', async () => {
    const result = await layoutBpmn(BYPASS_PROCESS);
    const geometry = await routingGeometry(result.xml);
    expectCleanRouting(geometry);

    const bypass = geometry.edges.find((edge) => edge.id === 'Flow_Bypass');
    expect(bypass?.points.length).toBeGreaterThan(2);
  });

  it('keeps the same bypass clean after top-to-bottom transposition', async () => {
    const result = await layoutBpmn(BYPASS_PROCESS, { direction: 'top-to-bottom' });
    expectCleanRouting(await routingGeometry(result.xml));
  });

  it('routes a message flow around unrelated nodes in intervening lanes', async () => {
    const result = await layoutBpmn(MESSAGE_OBSTACLE_PROCESS);
    const geometry = await routingGeometry(result.xml);
    expectCleanRouting(geometry);

    const message = geometry.edges.find((edge) => edge.id === 'Message_ToReceiver');
    expect(message?.points[0].x).toBe(message?.points.at(-1)?.x);
  });
});
