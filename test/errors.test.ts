import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import BpmnModdle from 'bpmn-moddle';
import { BpmnLayoutError, layoutBpmn } from '../src/index.js';

async function parse(xml: string): Promise<any> {
  return (await new BpmnModdle().fromXML(xml)).rootElement;
}

function shapeMap(definitions: any): Map<string, any> {
  return new Map(
    (definitions.diagrams[0]?.plane?.planeElement ?? [])
      .filter((e: any) => e.$type === 'bpmndi:BPMNShape')
      .map((e: any) => [e.bpmnElement.id, e]),
  );
}

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function inside(inner: any, outer: any): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

describe('diagnostics and errors', () => {
  it('rejects empty and malformed XML with a domain error', async () => {
    await expect(layoutBpmn('')).rejects.toBeInstanceOf(BpmnLayoutError);
    const malformed = layoutBpmn('<broken>');
    await expect(malformed).rejects.toBeInstanceOf(BpmnLayoutError);
    await expect(malformed).rejects.toHaveProperty('cause', expect.any(Error));
  });

  it('rejects documents without a layoutable process', async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Definitions_Empty" targetNamespace="http://example.com" />`;
    await expect(layoutBpmn(xml)).rejects.toThrow('No layoutable BPMN process');
  });

  it('rejects excessive subprocess nesting with a domain error', async () => {
    let content = '<bpmn:task id="Nested_Leaf" />';
    for (let depth = 0; depth < 258; depth += 1) {
      content = `<bpmn:subProcess id="Nested_${depth}">${content}</bpmn:subProcess>`;
    }
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Definitions_Deep" targetNamespace="http://example.com">
        <bpmn:process id="Process_Deep">${content}</bpmn:process>
      </bpmn:definitions>`;

    await expect(layoutBpmn(xml)).rejects.toMatchObject({
      name: 'BpmnLayoutError',
      message: expect.stringContaining('nesting exceeds the supported depth'),
    });
  });

  it('validates pins at the JavaScript API boundary', async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Definitions_Pins_Validation" targetNamespace="http://example.com">
        <bpmn:process id="Process_Pins_Validation"><bpmn:startEvent id="Start" /></bpmn:process>
      </bpmn:definitions>`;

    await expect(layoutBpmn(xml, { pins: 'Start' } as any)).rejects.toThrow(
      'The pins option must be an array of non-empty element IDs.',
    );
    await expect(layoutBpmn(xml, { pins: [''] })).rejects.toThrow(
      'The pins option must be an array of non-empty element IDs.',
    );
  });

  it('reports unassigned lane nodes without dropping them', async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Definitions_Unassigned" targetNamespace="http://example.com">
        <bpmn:process id="Process_1">
          <bpmn:laneSet id="LaneSet_1"><bpmn:lane id="Lane_1" /></bpmn:laneSet>
          <bpmn:startEvent id="Start" />
        </bpmn:process>
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    expect(result.diagnostics.map((item) => item.code)).toContain('UNASSIGNED_LANE_NODE');
    expect(result.xml).toContain('bpmnElement="Start"');
  });

  it('generates a valid empty plane for an empty process', async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Definitions_Empty_Process" targetNamespace="http://example.com">
        <bpmn:process id="Process_Empty" />
      </bpmn:definitions>`;
    const result = await layoutBpmn(xml);
    expect(result.metrics).toMatchObject({ shapeCount: 0, edgeCount: 0, width: 0, height: 0 });
    expect(result.xml).toContain('bpmnElement="Process_Empty"');
  });

  it('reports unsupported future constructs while preserving their semantics', async () => {
    const input = await readFile(join(fixtures, 'future-constructs.bpmn'), 'utf8');
    const result = await layoutBpmn(input);
    // Phase 5: all elements in this fixture are now handled — no errors expected.
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_ELEMENT')).toHaveLength(0);
    for (const id of ['Participant_Customer', 'Message_Request', 'SubProcess_Handle', 'Boundary_Timer', 'SubTask']) {
      expect(result.xml).toContain(`id="${id}"`);
    }
    const definitions = await parse(result.xml);
    const shapes = shapeMap(definitions);
    expect(shapes.has('Participant_Customer')).toBe(true);
    expect(shapes.has('Boundary_Timer')).toBe(true);
    // SubTask is inside the expanded SubProcess_Handle — must have a shape
    expect(shapes.has('SubTask')).toBe(true);
    const subProcBounds = shapes.get('SubProcess_Handle').bounds;
    expect(inside(shapes.get('SubTask').bounds, subProcBounds)).toBe(true);
  });
});
