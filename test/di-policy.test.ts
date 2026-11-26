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

function edgeMap(definitions: any): Map<string, any> {
  return new Map(
    (definitions.diagrams[0].plane.planeElement ?? [])
      .filter((e: any) => e.$type === 'bpmndi:BPMNEdge')
      .map((e: any) => [e.bpmnElement.id, e]),
  );
}

function expectEdgeTouchesSource(edge: any, shape: any): void {
  expect(edge.waypoint[0]).toMatchObject({
    x: shape.bounds.x + shape.bounds.width,
    y: shape.bounds.y + shape.bounds.height / 2,
  });
}

function inside(inner: any, outer: any): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
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

const BPMN_WITH_EDGE_DI = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Def_EdgePolicy" targetNamespace="http://example.com">
  <bpmn:process id="Proc_EdgePolicy">
    <bpmn:startEvent id="Edge_Start" />
    <bpmn:endEvent id="Edge_End" />
    <bpmn:sequenceFlow id="Edge_Flow" sourceRef="Edge_Start" targetRef="Edge_End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Edge_Diagram">
    <bpmndi:BPMNPlane id="Edge_Plane" bpmnElement="Proc_EdgePolicy">
      <bpmndi:BPMNShape id="Edge_Start_di" bpmnElement="Edge_Start">
        <dc:Bounds x="100" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Edge_End_di" bpmnElement="Edge_End">
        <dc:Bounds x="300" y="400" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_Flow_di" bpmnElement="Edge_Flow">
        <di:waypoint x="111" y="222" />
        <di:waypoint x="333" y="444" />
      </bpmndi:BPMNEdge>
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
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    // Start_P had existing DI at x=999 → must be preserved
    expect(shapes.get('Start_P').bounds.x).toBe(999);
    expect(shapes.get('Start_P').bounds.y).toBe(999);
    // Task_P also had existing DI → preserved
    expect(shapes.get('Task_P').bounds.x).toBe(1200);
    // End_P had no existing DI → auto-layout position (not 999)
    expect(shapes.has('End_P')).toBe(true);
    expect(shapes.get('End_P').bounds.x).not.toBe(999);
    expectEdgeTouchesSource(edgeMap(definitions).get('SF_P1'), shapes.get('Start_P'));
  });

  it('preserves existing shape and edge DI exactly for top-to-bottom layout', async () => {
    const result = await layoutBpmn(BPMN_WITH_EDGE_DI, {
      diPolicy: 'complete',
      direction: 'top-to-bottom',
    });
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    const edge = edgeMap(definitions).get('Edge_Flow');
    expect(shapes.get('Edge_Start').bounds).toMatchObject({ x: 100, y: 200, width: 36, height: 36 });
    expect(shapes.get('Edge_End').bounds).toMatchObject({ x: 300, y: 400, width: 36, height: 36 });
    expect(edge.waypoint.map(({ x, y }: any) => ({ x, y }))).toEqual([
      { x: 111, y: 222 },
      { x: 333, y: 444 },
    ]);
  });

  it.each(['left-to-right', 'top-to-bottom'] as const)(
    'keeps generated shapes clear of saved positions in %s layout',
    async (direction) => {
      const generated = shapeMap(await parse((await layoutBpmn(SIMPLE_BPMN, { direction })).xml));
      const { x, y } = generated.get('End_P').bounds;
      const input = SIMPLE_BPMN.replace('x="1200" y="980"', `x="${x}" y="${y}"`);
      const shapes = shapeMap(await parse((await layoutBpmn(input, { diPolicy: 'complete', direction })).xml));
      const saved = shapes.get('Task_P').bounds;
      const added = shapes.get('End_P').bounds;

      expect(saved).toMatchObject({ x, y, width: 100, height: 80 });
      expect(added.x >= saved.x + saved.width || added.x + added.width <= saved.x
        || added.y >= saved.y + saved.height || added.y + added.height <= saved.y).toBe(true);
    },
  );
});

describe('subprocess expansion', () => {
  it.each([
    { diPolicy: 'complete', expansion: ' isExpanded="false"' },
    { diPolicy: 'repair', expansion: '' },
  ] as const)('preserves a collapsed subprocess under $diPolicy', async ({ diPolicy, expansion }) => {
    const input = SIMPLE_BPMN.replace('<bpmn:task id="Task_P" name="Work" />',
      '<bpmn:subProcess id="Task_P" name="Work"><bpmn:task id="Inner" /></bpmn:subProcess>')
      .replace('bpmnElement="Task_P">', `bpmnElement="Task_P"${expansion}>`);
    const definitions = await parse((await layoutBpmn(input, { diPolicy })).xml);
    const shapes = shapeMap(definitions);
    const subprocess = definitions.rootElements[0].flowElements.find((element: any) => element.id === 'Task_P');

    expect(shapes.get('Task_P').isExpanded).toBe(false);
    expect(shapes.get('Task_P').bounds).toMatchObject({ x: 1200, y: 980, width: 100, height: 80 });
    expect(shapes.has('Inner')).toBe(false);
    expect(subprocess.flowElements.map((element: any) => element.id)).toEqual(['Inner']);

    const fresh = shapeMap(await parse((await layoutBpmn(input)).xml));
    expect(fresh.get('Task_P').isExpanded).toBe(true);
    expect(fresh.has('Inner')).toBe(true);
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

  it('replaces invalid (zero/negative) bounds with computed layout', async () => {
    const withInvalidDi = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Def_Invalid" targetNamespace="http://example.com">
  <bpmn:process id="Proc_Invalid">
    <bpmn:startEvent id="Inv_Start" />
    <bpmn:task id="Inv_Task" name="Work" />
    <bpmn:endEvent id="Inv_End" />
    <bpmn:sequenceFlow id="Inv_SF1" sourceRef="Inv_Start" targetRef="Inv_Task" />
    <bpmn:sequenceFlow id="Inv_SF2" sourceRef="Inv_Task" targetRef="Inv_End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_Invalid">
    <bpmndi:BPMNPlane id="Plane_Invalid" bpmnElement="Proc_Invalid">
      <bpmndi:BPMNShape id="Inv_Start_di" bpmnElement="Inv_Start">
        <dc:Bounds x="200" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Inv_Task_di" bpmnElement="Inv_Task">
        <dc:Bounds x="0" y="0" width="-1" height="-1" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const result = await layoutBpmn(withInvalidDi, { diPolicy: 'repair' });
    const shapes = shapeMap(await parse(result.xml));
    // Valid existing bounds preserved
    expect(shapes.get('Inv_Start').bounds.x).toBe(200);
    expect(shapes.get('Inv_Start').bounds.y).toBe(200);
    // Invalid bounds replaced with computed layout (positive width/height)
    const taskBounds = shapes.get('Inv_Task').bounds;
    expect(taskBounds.width).toBeGreaterThan(0);
    expect(taskBounds.height).toBeGreaterThan(0);
  });
});

describe('pins', () => {
  it('preserves pinned element positions regardless of policy', async () => {
    const result = await layoutBpmn(SIMPLE_BPMN, { diPolicy: 'replace', pins: ['Start_P'] });
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    // Pinned element keeps existing DI
    expect(shapes.get('Start_P').bounds.x).toBe(999);
    // Non-pinned element gets fresh layout
    expect(shapes.get('Task_P').bounds.x).not.toBe(1200);
    expectEdgeTouchesSource(edgeMap(definitions).get('SF_P1'), shapes.get('Start_P'));
  });

  it('moves generated subprocess content with a pinned container', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
        xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
        id="Def_Pinned_Sub" targetNamespace="http://example.com">
        <bpmn:process id="Proc_Pinned_Sub">
          <bpmn:subProcess id="Pinned_Sub"><bpmn:task id="Generated_Child" /></bpmn:subProcess>
        </bpmn:process>
        <bpmndi:BPMNDiagram id="Pinned_Sub_Diagram">
          <bpmndi:BPMNPlane id="Pinned_Sub_Plane" bpmnElement="Proc_Pinned_Sub">
            <bpmndi:BPMNShape id="Pinned_Sub_di" bpmnElement="Pinned_Sub">
              <dc:Bounds x="900" y="700" width="290" height="290" />
            </bpmndi:BPMNShape>
          </bpmndi:BPMNPlane>
        </bpmndi:BPMNDiagram>
      </bpmn:definitions>`;
    const definitions = await parse((await layoutBpmn(xml, { pins: ['Pinned_Sub'] })).xml);
    const shapes = shapeMap(definitions);

    expect(shapes.get('Pinned_Sub').bounds).toMatchObject({ x: 900, y: 700 });
    expect(inside(shapes.get('Generated_Child').bounds, shapes.get('Pinned_Sub').bounds)).toBe(true);
  });
});

function definitions_edges(definitions: any): any[] {
  return (definitions.diagrams[0].plane.planeElement ?? [])
    .filter((e: any) => e.$type === 'bpmndi:BPMNEdge');
}
