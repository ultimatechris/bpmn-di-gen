import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firefox } from 'playwright';
import { describe, expect, it } from 'vitest';
import { layoutBpmn } from '../src/index.js';

describe('visual regression baselines', () => {
  it('matches reviewed Phase 3 layouts', async () => {
    const browser = await firefox.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
      await page.setContent('<div id="canvas" style="width: 1400px; height: 900px"></div>');
      await page.addScriptTag({ path: resolve('node_modules/bpmn-js/dist/bpmn-navigated-viewer.development.js') });
      for (const name of ['single-process', 'lanes', 'nested-lanes']) {
        const input = await readFile(resolve(`test/fixtures/${name}.bpmn`), 'utf8');
        const { xml } = await layoutBpmn(input);
        await page.evaluate(async (bpmnXml) => {
          document.querySelector('#canvas')!.innerHTML = '';
          const viewer = new (window as any).BpmnJS({ container: '#canvas' });
          await viewer.importXML(bpmnXml);
          viewer.get('canvas').zoom('fit-viewport');
          (window as any).__viewer = viewer;
        }, xml);
        const actual = await page.locator('#canvas').screenshot();
        const expected = await readFile(resolve(`test/visual/${name}.png`));
        expect(actual.equals(expected), `${name} visual baseline changed`).toBe(true);
        await page.evaluate(() => (window as any).__viewer.destroy());
      }
    } finally {
      await browser.close();
    }
  }, 20_000);
});
