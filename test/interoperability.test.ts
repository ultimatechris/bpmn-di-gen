import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import { describe, expect, it } from 'vitest';
import { layoutBpmn } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('bpmn-js interoperability', () => {
  it('imports generated process and lane diagrams without warnings', async () => {
    const browser = await firefox.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="canvas" style="width: 1200px; height: 900px"></div>');
      await page.addScriptTag({ path: resolve('node_modules/bpmn-js/dist/bpmn-navigated-viewer.development.js') });

      for (const fixtureName of ['single-process.bpmn', 'lanes.bpmn', 'nested-lanes.bpmn']) {
        const input = await readFile(join(fixtures, fixtureName), 'utf8');
        const { xml, metrics } = await layoutBpmn(input);
        const imported = await page.evaluate(async ({ bpmnXml }) => {
          const Viewer = (window as any).BpmnJS;
          const viewer = new Viewer({ container: '#canvas' });
          const result = await viewer.importXML(bpmnXml);
          const elementCount = viewer.get('elementRegistry').getAll().length;
          viewer.destroy();
          return { warningCount: result.warnings.length, elementCount };
        }, { bpmnXml: xml });
        expect(imported.warningCount, fixtureName).toBe(0);
        expect(imported.elementCount, fixtureName).toBeGreaterThanOrEqual(metrics.shapeCount + metrics.edgeCount);
      }
    } finally {
      await browser.close();
    }
  }, 20_000);
});
