import { mkdtemp, readFile } from 'node:fs/promises';
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
});
