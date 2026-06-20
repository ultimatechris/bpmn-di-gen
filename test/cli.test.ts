import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import BpmnModdle from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('CLI', () => {
  it('writes a parseable BPMN file and reports layout counts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bpmn-di-gen-'));
    const output = join(directory, 'layouted.bpmn');
    const result = await exec(process.execPath, [
      resolve('dist/cli.js'),
      join(fixtures, 'lanes.bpmn'),
      '--output', output,
      '--spacing', 'compact',
    ]);
    expect(result.stderr).toContain('11 shapes, 5 edges');
    const xml = await readFile(output, 'utf8');
    const definitions = (await new BpmnModdle().fromXML(xml)).rootElement;
    expect(definitions.diagrams[0].plane.bpmnElement.id).toBe('Collaboration_Order');
  });

  it.each(['--direction', '--spacing', '--di-policy'])('rejects a missing value for %s', async (option) => {
    const directory = await mkdtemp(join(tmpdir(), 'bpmn-di-gen-'));
    const output = join(directory, 'layouted.bpmn');
    await expect(exec(process.execPath, [
      resolve('dist/cli.js'),
      join(fixtures, 'single-process.bpmn'),
      '--output', output,
      option,
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining(`Missing value for ${option}`),
    });
  });

  it('passes comma-separated pins to the layout API', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bpmn-di-gen-'));
    const input = join(directory, 'input.bpmn');
    const output = join(directory, 'layouted.bpmn');
    await writeFile(input, `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
        xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
        xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
        id="Definitions_Pins" targetNamespace="http://example.com">
        <bpmn:process id="Process_Pins">
          <bpmn:startEvent id="Start_Pinned" />
          <bpmn:task id="Task_Fresh" />
          <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_Pinned" targetRef="Task_Fresh" />
        </bpmn:process>
        <bpmndi:BPMNDiagram id="Diagram_Old">
          <bpmndi:BPMNPlane id="Plane_Old" bpmnElement="Process_Pins">
            <bpmndi:BPMNShape id="Start_Pinned_di" bpmnElement="Start_Pinned">
              <dc:Bounds x="999" y="888" width="36" height="36" />
            </bpmndi:BPMNShape>
          </bpmndi:BPMNPlane>
        </bpmndi:BPMNDiagram>
      </bpmn:definitions>`, 'utf8');

    await exec(process.execPath, [
      resolve('dist/cli.js'), input, '--output', output, '--pins', 'Start_Pinned,Task_Fresh',
    ]);
    const definitions = (await new BpmnModdle().fromXML(await readFile(output, 'utf8'))).rootElement;
    const pinned = definitions.diagrams[0].plane.planeElement
      .find((element: any) => element.bpmnElement?.id === 'Start_Pinned');
    expect(pinned.bounds).toMatchObject({ x: 999, y: 888 });
  });
});
