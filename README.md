# BPMN DI Auto-Layout

Generate readable BPMN Diagram Interchange (DI) for BPMN 2.0 XML that has no
usable layout information. The result is still a portable `.bpmn` file; this
package is a layout library and CLI, not an image renderer or modeler.

The implementation covers Phases 3–6 of the project roadmap:

**Layout**
- Deterministic single-process layered layout (events, tasks, gateways, cycles)
- Orthogonal sequence-flow routing with backward-flow channels
- Flat, empty, and nested lanes; lane-crossing flows
- Left-to-right and top-to-bottom directions; compact/normal/spacious presets

**Collaboration**
- Multiple pools stacked in declaration order
- Black-box (no-process) participants
- Message-flow routing between participant shapes

**BPMN Artifacts (Phase 5)**
- Boundary events placed on host border; exception-flow routing
- Expanded subprocess contents laid out recursively
- Text annotations placed beside process content; associations routed
- Data objects (DataObjectReference) and data stores placed above connected tasks
- Group artifacts as visual bounding boxes around member nodes

**DI Lifecycle (Phase 6)**
- `replace` (default): fresh layout; existing DI is discarded
- `complete`: preserve all existing shape positions; add DI only for new elements
- `repair`: restore valid existing shape positions; re-route all edges
- `pins`: keep specified element IDs at their current positions regardless of policy

See [Support Matrix](docs/support-matrix.md) for precise boundaries.

## Install

```sh
npm install
npm run build
```

The package requires Node.js 20 or newer.

## Library API

```ts
import { layoutBpmn } from 'bpmn-di-gen';

// Fresh layout (default)
const result = await layoutBpmn(inputXml, {
  direction: 'left-to-right',  // or 'top-to-bottom'
  spacing: 'normal',           // 'compact' | 'normal' | 'spacious'
  diPolicy: 'replace',         // 'replace' | 'complete' | 'repair'
});

// Preserve existing element positions; only add DI for new elements
const completed = await layoutBpmn(inputXml, { diPolicy: 'complete' });

// Re-route all edges; restore existing shape positions where valid
const repaired = await layoutBpmn(inputXml, { diPolicy: 'repair' });

// Pin specific elements; lay out everything else
const pinned = await layoutBpmn(inputXml, { pins: ['Task_Important', 'Lane_1'] });

await writeFile('layouted.bpmn', result.xml);
console.log(result.diagnostics, result.metrics);
```

`layoutBpmn` returns:

- `xml`: reparsed and structurally verified BPMN XML with generated DI
- `diagnostics`: recoverable input and layout issues
- `metrics`: shape, edge, lane, participant, size, and backward-edge counts

Unparseable input, documents without a process, and invalid generated DI throw a
`BpmnLayoutError`. The error exposes structured `diagnostics` where available.

## CLI

```sh
bpmn-di-gen input.bpmn --output layouted.bpmn
bpmn-di-gen input.bpmn -o layouted.bpmn --spacing compact
bpmn-di-gen input.bpmn -o layouted.bpmn --direction top-to-bottom
bpmn-di-gen input.bpmn -o layouted.bpmn --di-policy complete
bpmn-di-gen input.bpmn -o layouted.bpmn --di-policy repair
```

Run `bpmn-di-gen --help` for the complete option list.

## Layout Behavior

The implementation builds a BPMN-specific intermediate representation before
assigning any coordinates. Strongly connected components make cyclic graphs safe
to rank; the resulting component DAG is laid out in a stable topological order.

Lanes are hard partitions. Flow nodes are assigned to their deepest semantic lane,
each leaf lane is sized for its busiest rank, and parent lanes are sized around
their children. Empty lanes retain a usable minimum height. A participant is sized
around the complete lane structure.

Forward sequence flows use orthogonal routes between columns. Backward flows use
reserved channels above the process content. Existing DI is replaced; semantic
elements, IDs, references, vendor attributes, and extension elements are retained.

More detail is available in [Architecture](docs/architecture.md).

## Testing

Install the pinned test browser once:

```sh
npm run setup:test-browser
```

Then run the complete gate:

```sh
npm test
```

The gate compiles TypeScript and runs unit, structural, determinism, semantic
preservation, CLI, browser interoperability, and visual baseline tests. Generated
BPMN is reparsed internally on every library call. Browser tests also import all
main fixtures into `bpmn-js` in headless Firefox and require zero import warnings.

An additional independent parser check is available through `bpmn-python`:

```sh
python3 -m venv /tmp/bpmn-python-check
/tmp/bpmn-python-check/bin/pip install -r test/interoperability/requirements.txt
node dist/cli.js test/fixtures/lanes.bpmn -o /tmp/lanes-layout.bpmn
/tmp/bpmn-python-check/bin/python test/interoperability/verify_bpmn_python.py /tmp/lanes-layout.bpmn
```

Update visual baselines only after reviewing an intentional layout change:

```sh
npm run test:visual:update
```

## Current Limits

The following features are not yet supported:

- Label bounds and collision-aware label placement
- Explicit `CallActivity` expansion
- Shape-level collision avoidance for `complete` / `repair` modes (new nodes may overlap pinned ones)

Unsupported semantic content remains in the BPMN document. Layout-dependent
unsupported content may not receive DI; consult returned diagnostics and the
support matrix.

## Project Documents

- [Project concept and roadmap](PROJECT_CONCEPT.md)
- [Architecture](docs/architecture.md)
- [Phase 0 comparison and corpus](docs/comparison-and-corpus.md)
- [Support matrix](docs/support-matrix.md)

## License

MIT
