# bpmn-di-gen

Add readable layout to BPMN 2.0 files that have none.

BPMN files produced by execution engines, process-mining systems, AI generators,
and other automated tools often contain no visual coordinates. `bpmn-di-gen`
computes a standards-compliant Diagram Interchange (DI) layout and writes it back
into the same `.bpmn` file — leaving every semantic element untouched.

```
input.bpmn  ──▶  bpmn-di-gen  ──▶  output.bpmn
(no layout)                         (opens in any BPMN tool)
```

## When do you need this?

- Your `.bpmn` file opens as a blank canvas in Camunda Modeler, bpmn.io, or Signavio
- A process-mining tool (Celonis, ProM, PM4Py) exported a BPMN file without layout
- An AI tool or LLM generated BPMN XML with no `BPMNShape`/`BPMNEdge` elements
- Camunda, Flowable, or Activiti exported a deployed process definition that has no DI
- You're building a pipeline that produces BPMN programmatically and need to render it
- Your file has partial layout (some shapes placed, others missing) and you want to fill in the gaps

## Install

```sh
npm install bpmn-di-gen
```

Node.js 20 or later. The only runtime dependency is `bpmn-moddle`.

## Examples

### As a library

```ts
import { layoutBpmn } from 'bpmn-di-gen';
import { readFile, writeFile } from 'node:fs/promises';

const xml = await readFile('process.bpmn', 'utf8');
const { xml: result, diagnostics, metrics } = await layoutBpmn(xml);

await writeFile('process-layouted.bpmn', result);
console.log(`${metrics.shapeCount} shapes, ${metrics.edgeCount} edges`);
```

### As a CLI

```sh
bpmn-di-gen input.bpmn -o output.bpmn
bpmn-di-gen input.bpmn -o output.bpmn --direction top-to-bottom --spacing compact
bpmn-di-gen --help
```

## Options

| Option | Values | Default |
|--------|--------|---------|
| `direction` | `left-to-right` · `top-to-bottom` | `left-to-right` |
| `spacing` | `compact` · `normal` · `spacious` | `normal` |
| `diPolicy` | `replace` · `complete` · `repair` | `replace` |
| `pins` | `string[]` of element IDs | `[]` |

## Working with existing DI

Files that already contain partial layout information can be processed with one of
three policies:

| Policy | Behaviour |
|--------|-----------|
| `replace` | Discard all existing DI and generate a fresh layout |
| `complete` | Keep existing shape positions; fill in DI only for new elements |
| `repair` | Keep valid existing shapes; re-route all edges |

Specific elements can be locked to their current position regardless of policy:

```ts
// Re-route everything, but keep Task_Review where it is
const { xml } = await layoutBpmn(xml, {
  diPolicy: 'repair',
  pins: ['Task_Review'],
});
```

## What's supported

- Processes: start/end events, tasks, gateways, sequence flows, loops and cycles
- Pools and lanes, including nested lane sets and empty lanes
- Collaborations: multiple pools, black-box participants, message flows
- Boundary events attached to activities, with exception-flow routing
- Expanded subprocesses laid out recursively
- Text annotations, data objects, data stores, and group artifacts

Unsupported elements are never silently dropped — they remain in the file and
appear in the returned `diagnostics` array. See [docs/support-matrix.md](docs/support-matrix.md)
for the full coverage table.

## Return value

`layoutBpmn` resolves to:

```ts
{
  xml:         string;          // reparsed, validated BPMN XML with generated DI
  diagnostics: Diagnostic[];    // recoverable issues found during layout
  metrics:     LayoutMetrics;   // shape/edge/lane counts, diagram dimensions
}
```

Unrecoverable input (unparseable XML, no process found, invalid generated DI)
throws a `BpmnLayoutError` with structured diagnostics attached.

## Development

```sh
npm install
npm test         # build + full test suite
```

Visual baselines are committed to `test/visual/`. Regenerate them only after an
intentional layout change:

```sh
npm run setup:test-browser   # once: installs headless Firefox for browser tests
npm run test:visual:update
```

## License

[AGPL-3.0](LICENSE)
