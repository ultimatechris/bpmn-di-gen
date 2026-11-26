import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import BpmnModdle from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';
import { layoutBpmn } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const directions = ['left-to-right', 'top-to-bottom'] as const;

async function fixture(name: string): Promise<string> {
  return readFile(join(fixtures, name), 'utf8');
}

async function parse(xml: string): Promise<any> {
  return (await new BpmnModdle().fromXML(xml)).rootElement;
}

async function semanticXml(xml: string): Promise<string> {
  const moddle = new BpmnModdle();
  const { rootElement, warnings } = await moddle.fromXML(xml);
  expect(warnings.map((warning) => warning.message)).toEqual([]);
  // Compare normalized BPMN while allowing layout to replace the diagrams.
  rootElement.diagrams = [];
  return (await moddle.toXML(rootElement, { format: true })).xml;
}

function planeElements(definitions: any): any[] {
  return definitions.diagrams[0].plane.planeElement;
}

function shapeMap(definitions: any): Map<string, any> {
  return new Map(planeElements(definitions)
    .filter((element) => element.$type === 'bpmndi:BPMNShape')
    .map((element) => [element.bpmnElement.id, element]));
}

function inside(inner: any, outer: any): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function overlaps(a: any, b: any): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe.each(directions)('semantic round-trip in %s layout', (direction) => {
  it.each([
    'single-process.bpmn',
    'lanes.bpmn',
    'nested-lanes.bpmn',
    'collaboration.bpmn',
    'subprocess.bpmn',
    'boundary-events.bpmn',
    'artifacts.bpmn',
    'future-constructs.bpmn',
  ])('preserves the BPMN model in %s', async (name) => {
    const input = await fixture(name);
    const { xml } = await layoutBpmn(input, { direction });
    expect(await semanticXml(xml)).toBe(await semanticXml(input));
  });

  it.each(['complete', 'repair'] as const)('preserves the BPMN model with partial DI under %s', async (diPolicy) => {
    const input = await fixture('partial-di.bpmn');
    const { xml } = await layoutBpmn(input, { direction, diPolicy });
    expect(await semanticXml(xml)).toBe(await semanticXml(input));
  });

  it('preserves arbitrary extension elements', async () => {
    const input = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        xmlns:vendor="http://example.com/vendor" id="Definitions_Ext" targetNamespace="http://example.com">
        <bpmn:process id="Process_Ext">
          <bpmn:extensionElements><vendor:metadata key="value"><vendor:child>text</vendor:child></vendor:metadata></bpmn:extensionElements>
          <bpmn:startEvent id="Start_Ext" />
        </bpmn:process>
      </bpmn:definitions>`;
    const { xml } = await layoutBpmn(input, { direction });
    expect(await semanticXml(xml)).toBe(await semanticXml(input));
    expect(xml).toContain('<vendor:metadata key="value">');
    expect(xml).toContain('<vendor:child>text</vendor:child>');
  });
});

describe('single-process layout', () => {
  it('replaces DI and emits complete deterministic shapes and edges', async () => {
    const input = await fixture('single-process.bpmn');
    const first = await layoutBpmn(input);
    const second = await layoutBpmn(input);
    expect(first.xml).toBe(second.xml);
    expect(first.metrics).toMatchObject({ shapeCount: 6, edgeCount: 6, laneCount: 0 });
    expect(first.metrics.backwardEdgeCount).toBeGreaterThanOrEqual(1);

    const definitions = await parse(first.xml);
    expect(definitions.diagrams).toHaveLength(1);
    expect(definitions.diagrams[0].id).not.toBe('OldDiagram');
    const shapes = shapeMap(definitions);
    expect([...shapes.keys()].sort()).toEqual(['Approve', 'Decision', 'End', 'Review', 'Rework', 'Start']);
    const edges = planeElements(definitions).filter((element) => element.$type === 'bpmndi:BPMNEdge');
    expect(edges).toHaveLength(6);
    expect(edges.every((edge) => edge.waypoint.length >= 2)).toBe(true);

    const process = definitions.rootElements.find((element: any) => element.id === 'Process_Single');
    expect(process.name).toBe('Review request');
    expect(process.isExecutable).toBe(true);
    expect(process.$attrs['vendor:owner']).toBe('research');
    expect(definitions.$attrs['vendor:revision']).toBe('research-1');

    const loop = edges.find((edge) => edge.bpmnElement.id === 'Flow_Loop');
    const minimumNodeY = Math.min(...[...shapes.values()].map((shape) => shape.bounds.y));
    expect(Math.min(...loop.waypoint.map((point: any) => point.y))).toBeLessThan(minimumNodeY);
  });

  it('does not overlap flow-node shapes', async () => {
    const definitions = await parse((await layoutBpmn(await fixture('single-process.bpmn'))).xml);
    const bounds = [...shapeMap(definitions).values()].map((shape) => shape.bounds);
    for (let left = 0; left < bounds.length; left += 1) {
      for (let right = left + 1; right < bounds.length; right += 1) {
        expect(overlaps(bounds[left], bounds[right])).toBe(false);
      }
    }
  });

  it('supports top-to-bottom direction and spacing presets', async () => {
    const input = await fixture('single-process.bpmn');
    const horizontal = await layoutBpmn(input, { direction: 'left-to-right', spacing: 'compact' });
    const vertical = await layoutBpmn(input, { direction: 'top-to-bottom', spacing: 'spacious' });
    expect(horizontal.metrics.width).toBeGreaterThan(horizontal.metrics.height);
    expect(vertical.metrics.height).toBeGreaterThan(vertical.metrics.width);

    const definitions = await parse(vertical.xml);
    const shapes = shapeMap(definitions);
    const edges = planeElements(definitions)
      .filter((element) => element.$type === 'bpmndi:BPMNEdge');
    const firstForwardEdge = edges.find((edge) => edge.bpmnElement.id === 'Flow_1');
    const source = shapes.get(firstForwardEdge.bpmnElement.sourceRef.id).bounds;
    const target = shapes.get(firstForwardEdge.bpmnElement.targetRef.id).bounds;
    expect(firstForwardEdge.waypoint[0]).toMatchObject({
      x: source.x + source.width / 2,
      y: source.y + source.height,
    });
    expect(firstForwardEdge.waypoint.at(-1)).toMatchObject({
      x: target.x + target.width / 2,
      y: target.y,
    });
  });

  it('lays out disconnected components deterministically without overlaps', async () => {
    const input = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Definitions_Disconnected" targetNamespace="http://example.com">
        <bpmn:process id="Process_Disconnected">
          <bpmn:startEvent id="Start_A" /><bpmn:task id="Task_A" />
          <bpmn:startEvent id="Start_B" /><bpmn:task id="Task_B" />
          <bpmn:sequenceFlow id="Flow_A" sourceRef="Start_A" targetRef="Task_A" />
          <bpmn:sequenceFlow id="Flow_B" sourceRef="Start_B" targetRef="Task_B" />
        </bpmn:process>
      </bpmn:definitions>`;
    const definitions = await parse((await layoutBpmn(input)).xml);
    const bounds = [...shapeMap(definitions).values()].map((shape) => shape.bounds);
    for (let left = 0; left < bounds.length; left += 1) {
      for (let right = left + 1; right < bounds.length; right += 1) {
        expect(overlaps(bounds[left], bounds[right])).toBe(false);
      }
    }
  });

  it('keeps split and join gateways in forward ranks', async () => {
    const input = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Definitions_Join" targetNamespace="http://example.com">
        <bpmn:process id="Process_Join">
          <bpmn:startEvent id="Start" /><bpmn:parallelGateway id="Split" />
          <bpmn:task id="Branch_A" /><bpmn:task id="Branch_B" />
          <bpmn:parallelGateway id="Join" /><bpmn:endEvent id="End" />
          <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Split" />
          <bpmn:sequenceFlow id="F2" sourceRef="Split" targetRef="Branch_A" />
          <bpmn:sequenceFlow id="F3" sourceRef="Split" targetRef="Branch_B" />
          <bpmn:sequenceFlow id="F4" sourceRef="Branch_A" targetRef="Join" />
          <bpmn:sequenceFlow id="F5" sourceRef="Branch_B" targetRef="Join" />
          <bpmn:sequenceFlow id="F6" sourceRef="Join" targetRef="End" />
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(input);
    const shapes = shapeMap(await parse(result.xml));
    expect(shapes.get('Split').bounds.x).toBeLessThan(shapes.get('Branch_A').bounds.x);
    expect(shapes.get('Split').bounds.x).toBeLessThan(shapes.get('Branch_B').bounds.x);
    expect(shapes.get('Join').bounds.x).toBeGreaterThan(shapes.get('Branch_A').bounds.x);
    expect(shapes.get('Join').bounds.x).toBeGreaterThan(shapes.get('Branch_B').bounds.x);
    expect(result.metrics.backwardEdgeCount).toBe(0);
  });
});

describe('multiple standalone processes', () => {
  it('emits one correctly scoped diagram plane per process', async () => {
    const input = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Definitions_Multiple" targetNamespace="http://example.com">
        <bpmn:process id="Process_A"><bpmn:startEvent id="Start_A" /></bpmn:process>
        <bpmn:process id="Process_B"><bpmn:startEvent id="Start_B" /></bpmn:process>
      </bpmn:definitions>`;

    const definitions = await parse((await layoutBpmn(input)).xml);
    expect(definitions.diagrams).toHaveLength(2);
    expect(definitions.diagrams.map((diagram: any) => diagram.plane.bpmnElement.id)).toEqual([
      'Process_A',
      'Process_B',
    ]);
    expect(definitions.diagrams.map((diagram: any) => (
      diagram.plane.planeElement.map((element: any) => element.bpmnElement.id)
    ))).toEqual([['Start_A'], ['Start_B']]);
    expect(definitions.diagrams.map((diagram: any) => (
      diagram.plane.planeElement[0].bounds.y
    ))).toEqual([102, 102]);
  });
});

describe('multi-pool collaboration', () => {
  it('lays out three pools in collaboration order (black-box first)', async () => {
    const result = await layoutBpmn(await fixture('collaboration.bpmn'));
    expect(result.metrics.participantCount).toBe(3);
    expect(result.metrics.edgeCount).toBeGreaterThanOrEqual(4);

    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    expect(shapes.has('Participant_Customer')).toBe(true);
    expect(shapes.has('Participant_Shop')).toBe(true);
    expect(shapes.has('Participant_Supplier')).toBe(true);

    const customerY = shapes.get('Participant_Customer').bounds.y;
    const shopY = shapes.get('Participant_Shop').bounds.y;
    const supplierY = shapes.get('Participant_Supplier').bounds.y;
    expect(customerY).toBeLessThan(shopY);
    expect(shopY).toBeLessThan(supplierY);

    const pools = ['Participant_Customer', 'Participant_Shop', 'Participant_Supplier']
      .map((id) => shapes.get(id).bounds);
    for (let i = 0; i < pools.length; i += 1) {
      for (let j = i + 1; j < pools.length; j += 1) {
        expect(overlaps(pools[i], pools[j])).toBe(false);
      }
    }

    const edges = definitions.diagrams[0].plane.planeElement
      .filter((e: any) => e.$type === 'bpmndi:BPMNEdge');
    const edgeIds = edges.map((e: any) => e.bpmnElement.id);
    expect(edgeIds).toContain('MF_Order');
    expect(edgeIds).toContain('MF_Request');
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('outputs deterministic collaboration layout', async () => {
    const input = await fixture('collaboration.bpmn');
    const first = await layoutBpmn(input);
    const second = await layoutBpmn(input);
    expect(first.xml).toBe(second.xml);
  });

  it('transposes black-box participant bounds for top-to-bottom layout', async () => {
    const input = await fixture('collaboration.bpmn');
    const horizontal = shapeMap(await parse((await layoutBpmn(input)).xml));
    const vertical = shapeMap(await parse((await layoutBpmn(input, { direction: 'top-to-bottom' })).xml));
    const horizontalBounds = horizontal.get('Participant_Customer').bounds;
    const verticalBounds = vertical.get('Participant_Customer').bounds;

    expect(verticalBounds.x).toBe(horizontalBounds.y);
    expect(verticalBounds.y).toBe(horizontalBounds.x);
    expect(verticalBounds.width).toBe(horizontalBounds.height);
    expect(verticalBounds.height).toBe(horizontalBounds.width);
  });

  it('routes message flows whose endpoint is inside an expanded subprocess', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Def_SubMessage" targetNamespace="http://example.com">
        <bpmn:collaboration id="Collab_SubMessage">
          <bpmn:participant id="Part_Process" processRef="Proc_SubMessage" />
          <bpmn:participant id="Part_BlackBox" />
          <bpmn:messageFlow id="MF_SubTask" sourceRef="SubTask_Message" targetRef="Part_BlackBox" />
        </bpmn:collaboration>
        <bpmn:process id="Proc_SubMessage">
          <bpmn:subProcess id="Sub_Message">
            <bpmn:task id="SubTask_Message" />
          </bpmn:subProcess>
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    const edges = planeElements(await parse(result.xml))
      .filter((element) => element.$type === 'bpmndi:BPMNEdge');
    const messageEdge = edges.find((edge) => edge.bpmnElement.id === 'MF_SubTask');

    expect(messageEdge?.waypoint.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.filter((d) => d.code === 'UNROUTABLE_MESSAGE_FLOW')).toHaveLength(0);
  });

  it('routes message flows connected to boundary events', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Def_BoundaryMessage" targetNamespace="http://example.com">
        <bpmn:collaboration id="Collab_BoundaryMessage">
          <bpmn:participant id="Part_Boundary" processRef="Proc_BoundaryMessage" />
          <bpmn:participant id="Part_Receiver" />
          <bpmn:messageFlow id="MF_Boundary" sourceRef="Boundary_Message" targetRef="Part_Receiver" />
        </bpmn:collaboration>
        <bpmn:process id="Proc_BoundaryMessage">
          <bpmn:task id="Task_BoundaryMessage" />
          <bpmn:boundaryEvent id="Boundary_Message" attachedToRef="Task_BoundaryMessage" />
        </bpmn:process>
      </bpmn:definitions>`;

    const result = await layoutBpmn(xml);
    const messageEdge = planeElements(await parse(result.xml))
      .find((element) => element.bpmnElement?.id === 'MF_Boundary');
    expect(messageEdge?.waypoint.length).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics.filter((d) => d.code === 'UNROUTABLE_MESSAGE_FLOW')).toHaveLength(0);
  });

  it('generates shapes for black-box participants', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Def_BB" targetNamespace="http://example.com">
        <bpmn:collaboration id="Collab_BB">
          <bpmn:participant id="Part_Customer" name="Customer" />
          <bpmn:participant id="Part_Shop" name="Shop" processRef="Proc_Shop" />
        </bpmn:collaboration>
        <bpmn:process id="Proc_Shop">
          <bpmn:startEvent id="Start_Shop" /><bpmn:endEvent id="End_Shop" />
          <bpmn:sequenceFlow id="SF_Shop" sourceRef="Start_Shop" targetRef="End_Shop" />
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    expect(result.metrics.participantCount).toBe(2);
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    expect(shapes.has('Part_Customer')).toBe(true);
    const bb = shapes.get('Part_Customer').bounds;
    expect(bb.width).toBeGreaterThan(0);
    expect(bb.height).toBeGreaterThan(0);
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
  });
});

describe('boundary events', () => {
  it('separates multiple events along their host border', async () => {
    const { xml } = await layoutBpmn(`<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
      id="Def_MultipleEvents" targetNamespace="http://example.com">
      <bpmn:process id="Process_Events">
        <bpmn:task id="Host" />
        <bpmn:boundaryEvent id="Error" attachedToRef="Host"><bpmn:errorEventDefinition /></bpmn:boundaryEvent>
        <bpmn:boundaryEvent id="Timer" attachedToRef="Host"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
        <bpmn:boundaryEvent id="Signal" attachedToRef="Host"><bpmn:signalEventDefinition /></bpmn:boundaryEvent>
      </bpmn:process>
    </bpmn:definitions>`);
    const shapes = shapeMap(await parse(xml));
    const host = shapes.get('Host').bounds;
    const events = ['Error', 'Timer', 'Signal'].map((id) => shapes.get(id).bounds);

    for (const [index, bounds] of events.entries()) {
      expect(bounds.y + bounds.height / 2).toBe(host.y + host.height);
      expect(bounds.x).toBeGreaterThanOrEqual(host.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(host.x + host.width);
      expect(events.slice(0, index).some((other) => overlaps(bounds, other))).toBe(false);
    }
  });

  it('places boundary event on host border and routes exception flow', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Def_BE" targetNamespace="http://example.com">
        <bpmn:process id="Proc_BE">
          <bpmn:startEvent id="Start_BE" />
          <bpmn:task id="Task_BE" name="Do work" />
          <bpmn:endEvent id="End_Normal" />
          <bpmn:endEvent id="End_Error" />
          <bpmn:boundaryEvent id="Boundary_Error" attachedToRef="Task_BE">
            <bpmn:errorEventDefinition />
          </bpmn:boundaryEvent>
          <bpmn:sequenceFlow id="SF_BE1" sourceRef="Start_BE" targetRef="Task_BE" />
          <bpmn:sequenceFlow id="SF_BE2" sourceRef="Task_BE" targetRef="End_Normal" />
          <bpmn:sequenceFlow id="SF_Exception" sourceRef="Boundary_Error" targetRef="End_Error" />
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
    expect(result.diagnostics.filter((d) => d.code === 'INVALID_SEQUENCE_FLOW')).toHaveLength(0);

    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    expect(shapes.has('Boundary_Error')).toBe(true);
    const beBounds = shapes.get('Boundary_Error').bounds;
    const hostBounds = shapes.get('Task_BE').bounds;
    expect(beBounds.x + beBounds.width / 2).toBeCloseTo(hostBounds.x + hostBounds.width / 2, 0);
    expect(beBounds.y + beBounds.height / 2).toBeGreaterThanOrEqual(hostBounds.y + hostBounds.height - 5);

    const edges = definitions.diagrams[0].plane.planeElement
      .filter((e: any) => e.$type === 'bpmndi:BPMNEdge');
    expect(edges.map((e: any) => e.bpmnElement.id)).toContain('SF_Exception');
  });

  it('handles the boundary-events fixture without errors', async () => {
    const result = await layoutBpmn(await fixture('boundary-events.bpmn'));
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
    const shapes = shapeMap(await parse(result.xml));
    expect(shapes.has('Boundary_Err')).toBe(true);
    expect(shapes.has('Task_Main')).toBe(true);
    const beBounds = shapes.get('Boundary_Err').bounds;
    const taskBounds = shapes.get('Task_Main').bounds;
    expect(beBounds.y + beBounds.height / 2).toBeGreaterThanOrEqual(taskBounds.y + taskBounds.height - 2);
  });
});

describe('annotations and associations', () => {
  it('generates shapes and edges for text annotations', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Def_Ann" targetNamespace="http://example.com">
        <bpmn:process id="Proc_Ann">
          <bpmn:startEvent id="Start_Ann" />
          <bpmn:task id="Task_Ann" name="Do work" />
          <bpmn:endEvent id="End_Ann" />
          <bpmn:sequenceFlow id="SF_Ann1" sourceRef="Start_Ann" targetRef="Task_Ann" />
          <bpmn:sequenceFlow id="SF_Ann2" sourceRef="Task_Ann" targetRef="End_Ann" />
          <bpmn:textAnnotation id="Ann1" text="Important note" />
          <bpmn:association id="Assoc1" sourceRef="Task_Ann" targetRef="Ann1"
            associationDirection="None" />
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    expect(shapes.has('Ann1')).toBe(true);
    const annBounds = shapes.get('Ann1').bounds;
    expect(annBounds.width).toBeGreaterThan(0);
    expect(annBounds.height).toBeGreaterThan(0);
    const edges = definitions.diagrams[0].plane.planeElement
      .filter((e: any) => e.$type === 'bpmndi:BPMNEdge');
    expect(edges.map((e: any) => e.bpmnElement.id)).toContain('Assoc1');
  });
});

describe('data elements', () => {
  it('generates shapes for data object references', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Def_Data" targetNamespace="http://example.com">
        <bpmn:process id="Proc_Data">
          <bpmn:startEvent id="Start_D" />
          <bpmn:task id="Task_D" name="Save data">
            <bpmn:property id="InputProperty" />
            <bpmn:dataInputAssociation id="DIA1">
              <bpmn:sourceRef>DataRef1</bpmn:sourceRef>
              <bpmn:targetRef>InputProperty</bpmn:targetRef>
            </bpmn:dataInputAssociation>
            <bpmn:dataOutputAssociation id="DOA1">
              <bpmn:targetRef>DataRef1</bpmn:targetRef>
            </bpmn:dataOutputAssociation>
          </bpmn:task>
          <bpmn:endEvent id="End_D" />
          <bpmn:dataObject id="DataObj1" />
          <bpmn:dataObjectReference id="DataRef1" dataObjectRef="DataObj1" name="Order data" />
          <bpmn:sequenceFlow id="SF_D1" sourceRef="Start_D" targetRef="Task_D" />
          <bpmn:sequenceFlow id="SF_D2" sourceRef="Task_D" targetRef="End_D" />
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    expect(shapes.has('DataRef1')).toBe(true);
    const dataBounds = shapes.get('DataRef1').bounds;
    expect(dataBounds.width).toBeGreaterThan(0);
    expect(dataBounds.height).toBeGreaterThan(0);
    expect(dataBounds.y).toBeGreaterThanOrEqual(0);
    const taskBounds = shapes.get('Task_D').bounds;
    const input = planeElements(definitions).find((element) => element.bpmnElement.id === 'DIA1');
    const output = planeElements(definitions).find((element) => element.bpmnElement.id === 'DOA1');
    const dataPort = { x: dataBounds.x + dataBounds.width / 2, y: dataBounds.y + dataBounds.height };
    const taskPort = { x: taskBounds.x + taskBounds.width / 2, y: taskBounds.y };
    expect(input.waypoint).toMatchObject([dataPort, taskPort]);
    expect(output.waypoint).toMatchObject([taskPort, dataPort]);
  });
});

describe('expanded subprocesses', () => {
  it('places subprocess as expanded container with child shapes inside', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Def_Sub" targetNamespace="http://example.com">
        <bpmn:process id="Proc_Sub">
          <bpmn:startEvent id="Start_S" />
          <bpmn:subProcess id="SubProc1" name="Sub work">
            <bpmn:startEvent id="Sub_Start" />
            <bpmn:task id="Sub_Task" name="Inner task" />
            <bpmn:endEvent id="Sub_End" />
            <bpmn:sequenceFlow id="Sub_SF1" sourceRef="Sub_Start" targetRef="Sub_Task" />
            <bpmn:sequenceFlow id="Sub_SF2" sourceRef="Sub_Task" targetRef="Sub_End" />
          </bpmn:subProcess>
          <bpmn:endEvent id="End_S" />
          <bpmn:sequenceFlow id="SF_S1" sourceRef="Start_S" targetRef="SubProc1" />
          <bpmn:sequenceFlow id="SF_S2" sourceRef="SubProc1" targetRef="End_S" />
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
    const definitions = await parse(result.xml);
    const elements = planeElements(definitions);
    expect(result.metrics.shapeCount).toBe(elements.filter((element) => element.$type === 'bpmndi:BPMNShape').length);
    expect(result.metrics.edgeCount).toBe(elements.filter((element) => element.$type === 'bpmndi:BPMNEdge').length);
    const shapes = shapeMap(definitions);
    expect(shapes.has('SubProc1')).toBe(true);
    expect(shapes.get('SubProc1').isExpanded).toBe(true);
    const subBounds = shapes.get('SubProc1').bounds;
    expect(subBounds.width).toBeGreaterThan(100);
    expect(subBounds.height).toBeGreaterThan(80);
    expect(shapes.has('Sub_Task')).toBe(true);
    expect(inside(shapes.get('Sub_Task').bounds, subBounds)).toBe(true);
  });

  it.each(directions)('contains child shapes and routes in %s layout', async (direction) => {
    const result = await layoutBpmn(await fixture('subprocess.bpmn'), { direction });
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    expect(shapes.has('SP1')).toBe(true);
    expect(shapes.get('SP1').isExpanded).toBe(true);
    const spBounds = shapes.get('SP1').bounds;
    for (const id of ['SubStart', 'SubTask', 'SubEnd']) {
      expect(inside(shapes.get(id).bounds, spBounds), id).toBe(true);
    }
    for (const id of ['SubFlow1', 'SubFlow2']) {
      const edge = planeElements(definitions).find((element) => element.bpmnElement.id === id);
      expect(edge.waypoint.length, id).toBeGreaterThanOrEqual(2);
      for (const { x, y } of edge.waypoint) {
        expect(inside({ x, y, width: 0, height: 0 }, spBounds), id).toBe(true);
      }
    }
  });

  it('emits and offsets lanes inside an expanded subprocess', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Def_Sub_Lane" targetNamespace="http://example.com">
        <bpmn:process id="Proc_Sub_Lane">
          <bpmn:subProcess id="Sub_Lane">
            <bpmn:laneSet id="Sub_LaneSet">
              <bpmn:lane id="Inner_Lane"><bpmn:flowNodeRef>Inner_Task</bpmn:flowNodeRef></bpmn:lane>
            </bpmn:laneSet>
            <bpmn:task id="Inner_Task" />
          </bpmn:subProcess>
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    const elements = planeElements(definitions);

    expect(shapes.has('Inner_Lane')).toBe(true);
    expect(inside(shapes.get('Inner_Lane').bounds, shapes.get('Sub_Lane').bounds)).toBe(true);
    expect(inside(shapes.get('Inner_Task').bounds, shapes.get('Inner_Lane').bounds)).toBe(true);
    expect(result.metrics.shapeCount).toBe(
      elements.filter((element) => element.$type === 'bpmndi:BPMNShape').length,
    );
  });
});

describe('groups', () => {
  it('generates a shape for a group artifact encompassing process content', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Def_Group" targetNamespace="http://example.com">
        <bpmn:process id="Proc_Group">
          <bpmn:startEvent id="Start_G" />
          <bpmn:task id="Task_G" name="Do work" />
          <bpmn:endEvent id="End_G" />
          <bpmn:sequenceFlow id="SF_G1" sourceRef="Start_G" targetRef="Task_G" />
          <bpmn:sequenceFlow id="SF_G2" sourceRef="Task_G" targetRef="End_G" />
          <bpmn:group id="Group1" />
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    expect(shapes.has('Group1')).toBe(true);
    const groupBounds = shapes.get('Group1').bounds;
    expect(groupBounds.width).toBeGreaterThan(0);
    expect(groupBounds.height).toBeGreaterThan(0);
    // Group must encompass all node shapes
    for (const nodeId of ['Start_G', 'Task_G', 'End_G']) {
      expect(inside(shapes.get(nodeId).bounds, groupBounds)).toBe(true);
    }
  });
});

describe('lane-aware layout', () => {
  it.each(directions)('contains all lanes and their flow nodes in %s layout', async (direction) => {
    const result = await layoutBpmn(await fixture('lanes.bpmn'), { direction });
    expect(result.metrics).toMatchObject({ laneCount: 4, participantCount: 1, shapeCount: 11, edgeCount: 5 });
    const definitions = await parse(result.xml);
    expect(definitions.diagrams[0].plane.bpmnElement.id).toBe('Collaboration_Order');
    const shapes = shapeMap(definitions);
    const participant = shapes.get('Participant_Shop').bounds;
    const thickness = direction === 'left-to-right' ? 'height' : 'width';
    for (const laneId of ['Lane_Office', 'Lane_Warehouse', 'Lane_Shipping', 'Lane_Empty']) {
      expect(inside(shapes.get(laneId).bounds, participant)).toBe(true);
      expect(shapes.get(laneId).bounds[thickness], laneId).toBeGreaterThanOrEqual(140);
    }
    const expectedLanes: Record<string, string> = {
      Start: 'Lane_Office', Register: 'Lane_Office', Check: 'Lane_Warehouse', Pack: 'Lane_Warehouse',
      Ship: 'Lane_Shipping', End: 'Lane_Shipping',
    };
    for (const [nodeId, laneId] of Object.entries(expectedLanes)) {
      expect(inside(shapes.get(nodeId).bounds, shapes.get(laneId).bounds)).toBe(true);
    }
    expect(result.diagnostics).toEqual([]);
  });

  it.each(directions)('contains nested lanes and their flow nodes in %s layout', async (direction) => {
    const result = await layoutBpmn(await fixture('nested-lanes.bpmn'), { direction });
    expect(result.metrics.laneCount).toBe(3);
    const shapes = shapeMap(await parse(result.xml));
    const parent = shapes.get('Lane_Operations').bounds;
    expect(inside(shapes.get('Lane_Team_A').bounds, parent)).toBe(true);
    expect(inside(shapes.get('Lane_Team_B').bounds, parent)).toBe(true);
    expect(inside(shapes.get('Start').bounds, shapes.get('Lane_Team_A').bounds)).toBe(true);
    expect(inside(shapes.get('Task_A').bounds, shapes.get('Lane_Team_A').bounds)).toBe(true);
    expect(inside(shapes.get('Task_B').bounds, shapes.get('Lane_Team_B').bounds)).toBe(true);
    expect(inside(shapes.get('End').bounds, shapes.get('Lane_Team_B').bounds)).toBe(true);
  });
});

describe('artifacts fixture', () => {
  it('lays out annotation, data objects, expanded subprocess, and group without errors', async () => {
    const result = await layoutBpmn(await fixture('artifacts.bpmn'));
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
    const definitions = await parse(result.xml);
    const elements = planeElements(definitions);
    expect(result.metrics.shapeCount).toBe(elements.filter((element) => element.$type === 'bpmndi:BPMNShape').length);
    expect(result.metrics.edgeCount).toBe(elements.filter((element) => element.$type === 'bpmndi:BPMNEdge').length);
    const shapes = shapeMap(definitions);

    // expanded subprocess
    expect(shapes.has('SubProc_Fulfill')).toBe(true);
    expect(shapes.get('SubProc_Fulfill').isExpanded).toBe(true);
    const subBounds = shapes.get('SubProc_Fulfill').bounds;
    expect(inside(shapes.get('Sub_Pack').bounds, subBounds)).toBe(true);

    // annotation shape
    expect(shapes.has('Ann_Validate')).toBe(true);

    // data object and data store
    expect(shapes.has('DataRef_Order')).toBe(true);
    expect(shapes.has('DataStore_CRM')).toBe(true);

    // group shape encompasses core nodes
    expect(shapes.has('Group_Core')).toBe(true);
    const groupBounds = shapes.get('Group_Core').bounds;
    expect(inside(shapes.get('Task_Validate').bounds, groupBounds)).toBe(true);
    expect(inside(shapes.get('Task_Invoice').bounds, groupBounds)).toBe(true);

    // association edge
    const edges = planeElements(definitions).filter((e: any) => e.$type === 'bpmndi:BPMNEdge');
    expect(edges.map((e: any) => e.bpmnElement.id)).toContain('Assoc_Validate');
  });
});
