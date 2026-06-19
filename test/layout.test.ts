import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import BpmnModdle from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';
import { layoutBpmn } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function fixture(name: string): Promise<string> {
  return readFile(join(fixtures, name), 'utf8');
}

async function parse(xml: string): Promise<any> {
  return (await new BpmnModdle().fromXML(xml)).rootElement;
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
    const result = await layoutBpmn(input);
    expect(result.xml).toContain('<vendor:metadata key="value">');
    expect(result.xml).toContain('<vendor:child>text</vendor:child>');
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

describe('lane-aware layout', () => {
  it('places every flow node in its semantic lane and sizes the participant', async () => {
    const result = await layoutBpmn(await fixture('lanes.bpmn'));
    expect(result.metrics).toMatchObject({ laneCount: 4, participantCount: 1, shapeCount: 11, edgeCount: 5 });
    const definitions = await parse(result.xml);
    expect(definitions.diagrams[0].plane.bpmnElement.id).toBe('Collaboration_Order');
    const shapes = shapeMap(definitions);
    const participant = shapes.get('Participant_Shop').bounds;
    for (const laneId of ['Lane_Office', 'Lane_Warehouse', 'Lane_Shipping', 'Lane_Empty']) {
      expect(inside(shapes.get(laneId).bounds, participant)).toBe(true);
      expect(shapes.get(laneId).bounds.height).toBeGreaterThanOrEqual(140);
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

  it('supports nested lanes and contains children in the parent lane', async () => {
    const result = await layoutBpmn(await fixture('nested-lanes.bpmn'));
    expect(result.metrics.laneCount).toBe(3);
    const shapes = shapeMap(await parse(result.xml));
    const parent = shapes.get('Lane_Operations').bounds;
    expect(inside(shapes.get('Lane_Team_A').bounds, parent)).toBe(true);
    expect(inside(shapes.get('Lane_Team_B').bounds, parent)).toBe(true);
    expect(inside(shapes.get('Task_A').bounds, shapes.get('Lane_Team_A').bounds)).toBe(true);
    expect(inside(shapes.get('Task_B').bounds, shapes.get('Lane_Team_B').bounds)).toBe(true);
  });
});
