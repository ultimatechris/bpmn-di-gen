import { describe, expect, it } from 'vitest';
import BpmnModdle from 'bpmn-moddle';
import { layoutBpmn } from '../src/index.js';

async function parse(xml: string): Promise<any> {
  return (await new BpmnModdle().fromXML(xml)).rootElement;
}

function shapeMap(definitions: any): Map<string, any> {
  return new Map(
    (definitions.diagrams[0].plane.planeElement ?? [])
      .filter((e: any) => e.$type === 'bpmndi:BPMNShape')
      .map((e: any) => [e.bpmnElement.id, e]),
  );
}

const SIMPLE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Def_Policy" targetNamespace="http://example.com">
  <bpmn:process id="Proc_Policy">
    <bpmn:startEvent id="Start_P" />
    <bpmn:task id="Task_P" name="Work" />
    <bpmn:endEvent id="End_P" />
    <bpmn:sequenceFlow id="SF_P1" sourceRef="Start_P" targetRef="Task_P" />
    <bpmn:sequenceFlow id="SF_P2" sourceRef="Task_P" targetRef="End_P" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_Old">
    <bpmndi:BPMNPlane id="Plane_Old" bpmnElement="Proc_Policy">
      <bpmndi:BPMNShape id="Start_P_di" bpmnElement="Start_P">
        <dc:Bounds x="999" y="999" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_P_di" bpmnElement="Task_P">
        <dc:Bounds x="1200" y="980" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('diPolicy: replace (default)', () => {
  it('discards all existing DI and generates fresh layout', async () => {
    const result = await layoutBpmn(SIMPLE_BPMN, { diPolicy: 'replace' });
    const shapes = shapeMap(await parse(result.xml));
    expect(shapes.get('Start_P').bounds.x).not.toBe(999);
  });
});

describe('diPolicy: complete', () => {
  it('keeps existing shape positions and only adds DI for new elements', async () => {
    const result = await layoutBpmn(SIMPLE_BPMN, { diPolicy: 'complete' });
    const shapes = shapeMap(await parse(result.xml));
    // Start_P had existing DI at x=999 → must be preserved
    expect(shapes.get('Start_P').bounds.x).toBe(999);
    expect(shapes.get('Start_P').bounds.y).toBe(999);
    // Task_P also had existing DI → preserved
    expect(shapes.get('Task_P').bounds.x).toBe(1200);
    // End_P had no existing DI → auto-layout position (not 999)
    expect(shapes.has('End_P')).toBe(true);
    expect(shapes.get('End_P').bounds.x).not.toBe(999);
  });
});

describe('diPolicy: repair', () => {
  it('restores valid shape positions and re-routes all edges', async () => {
    const result = await layoutBpmn(SIMPLE_BPMN, { diPolicy: 'repair' });
    const shapes = shapeMap(await parse(result.xml));
    // Start_P had existing valid DI → preserved
    expect(shapes.get('Start_P').bounds.x).toBe(999);
    // End_P had no existing DI → auto-layout position
    expect(shapes.has('End_P')).toBe(true);
    // edges must still be present
    const edges = definitions_edges(await parse(result.xml));
    expect(edges.map((e: any) => e.bpmnElement.id)).toContain('SF_P1');
  });
});

describe('pins', () => {
  it('preserves pinned element positions regardless of policy', async () => {
    const result = await layoutBpmn(SIMPLE_BPMN, { diPolicy: 'replace', pins: ['Start_P'] });
    const shapes = shapeMap(await parse(result.xml));
    // Pinned element keeps existing DI
    expect(shapes.get('Start_P').bounds.x).toBe(999);
    // Non-pinned element gets fresh layout
    expect(shapes.get('Task_P').bounds.x).not.toBe(1200);
  });
});

function definitions_edges(definitions: any): any[] {
  return (definitions.diagrams[0].plane.planeElement ?? [])
    .filter((e: any) => e.$type === 'bpmndi:BPMNEdge');
}
