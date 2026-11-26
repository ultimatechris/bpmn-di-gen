import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { layoutBpmn, type DiPolicy } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const directions = ['left-to-right', 'top-to-bottom'] as const;
const partialDiIds = ['Start_Partial', 'Task_Partial', 'End_Partial', 'Flow_StartToTask', 'Flow_TaskToEnd'];

const importCases: Array<{
  name: string;
  fixture: string;
  requiredIds: string[];
  diPolicy?: DiPolicy;
}> = [
  {
    name: 'a standalone process with a loop',
    fixture: 'single-process.bpmn',
    requiredIds: ['Start', 'Review', 'Decision', 'Flow_Loop', 'End'],
  },
  {
    name: 'a pool with lanes',
    fixture: 'lanes.bpmn',
    requiredIds: ['Participant_Shop', 'Lane_Office', 'Lane_Empty', 'Flow_3'],
  },
  {
    name: 'a process with nested lanes',
    fixture: 'nested-lanes.bpmn',
    requiredIds: ['Lane_Operations', 'Lane_Team_A', 'Lane_Team_B', 'Flow_2'],
  },
  {
    name: 'a collaboration with message flows',
    fixture: 'collaboration.bpmn',
    requiredIds: [
      'Participant_Customer', 'Participant_Shop', 'Participant_Supplier',
      'MF_Order', 'MF_Confirm', 'MF_Request', 'MF_Delivery',
    ],
  },
  {
    name: 'an expanded subprocess with child flows',
    fixture: 'subprocess.bpmn',
    requiredIds: ['SP1', 'SubStart', 'SubTask', 'SubEnd', 'SubFlow1', 'SubFlow2'],
  },
  {
    name: 'a boundary event and its exception flow',
    fixture: 'boundary-events.bpmn',
    requiredIds: ['Task_Main', 'Boundary_Err', 'Task_Handle', 'SF3', 'End_Error'],
  },
  {
    name: 'completed partial DI',
    fixture: 'partial-di.bpmn',
    requiredIds: partialDiIds,
    diPolicy: 'complete',
  },
  {
    name: 'repaired partial DI',
    fixture: 'partial-di.bpmn',
    requiredIds: partialDiIds,
    diPolicy: 'repair',
  },
];

describe('bpmn-js interoperability', () => {
  let browser: Browser | undefined;
  let page: Page;

  beforeAll(async () => {
    browser = await firefox.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent('<div id="canvas" style="width: 1200px; height: 900px"></div>');
    await page.addScriptTag({ path: resolve('node_modules/bpmn-js/dist/bpmn-navigated-viewer.development.js') });
  }, 20_000);

  afterAll(async () => {
    await browser?.close();
  });

  describe.each(directions)('%s layout', (direction) => {
    it.each(importCases)('imports $name without warnings', async ({ fixture, requiredIds, diPolicy }) => {
      const input = await readFile(join(fixtures, fixture), 'utf8');
      const { xml, metrics } = await layoutBpmn(input, { direction, diPolicy });
      const imported = await page.evaluate(async (bpmnXml) => {
        const Viewer = (window as any).BpmnJS;
        const viewer = new Viewer({ container: '#canvas' });
        try {
          const { warnings } = await viewer.importXML(bpmnXml);
          const elements: Array<{ id: string }> = viewer.get('elementRegistry').getAll();
          return {
            warnings: warnings.map((warning: { message: string }) => warning.message),
            ids: elements.map((element) => element.id),
          };
        } finally {
          viewer.destroy();
        }
      }, xml);

      expect(imported.warnings).toEqual([]);
      expect(imported.ids).toEqual(expect.arrayContaining(requiredIds));
      expect(imported.ids.length).toBeGreaterThanOrEqual(metrics.shapeCount + metrics.edgeCount);
    });
  });
});
