import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firefox } from 'playwright';
import { layoutBpmn } from '../dist/index.js';

const outputDirectory = resolve('test/visual');
await mkdir(outputDirectory, { recursive: true });
const browser = await firefox.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent('<div id="canvas" style="width: 1400px; height: 900px"></div>');
  await page.addScriptTag({ path: resolve('node_modules/bpmn-js/dist/bpmn-navigated-viewer.development.js') });
  for (const name of ['single-process', 'lanes', 'nested-lanes']) {
    const input = await readFile(resolve(`test/fixtures/${name}.bpmn`), 'utf8');
    const { xml } = await layoutBpmn(input);
    await page.evaluate(async (bpmnXml) => {
      document.querySelector('#canvas').innerHTML = '';
      const viewer = new window.BpmnJS({ container: '#canvas' });
      await viewer.importXML(bpmnXml);
      viewer.get('canvas').zoom('fit-viewport');
      window.__viewer = viewer;
    }, xml);
    await page.locator('#canvas').screenshot({ path: resolve(outputDirectory, `${name}.png`) });
    await page.evaluate(() => window.__viewer.destroy());
  }
} finally {
  await browser.close();
}
