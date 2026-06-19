import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpmnLayoutError, layoutBpmn } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('diagnostics and errors', () => {
  it('rejects empty and malformed XML with a domain error', async () => {
    await expect(layoutBpmn('')).rejects.toBeInstanceOf(BpmnLayoutError);
    await expect(layoutBpmn('<broken>')).rejects.toBeInstanceOf(BpmnLayoutError);
  });

  it('rejects documents without a layoutable process', async () => {
    const xml = `<?xml version="1.0"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        id="Definitions_Empty" targetNamespace="http://example.com" />`;
    await expect(layoutBpmn(xml)).rejects.toThrow('No layoutable BPMN process');
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
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'UNSUPPORTED_ELEMENT',
      'INVALID_SEQUENCE_FLOW',
      'UNROUTABLE_MESSAGE_FLOW',
    ]));
    for (const id of ['Participant_Customer', 'Message_Request', 'SubProcess_Handle', 'Boundary_Timer', 'SubTask']) {
      expect(result.xml).toContain(`id="${id}"`);
    }
  });
});
