# BPMN DI Auto-Layout

Generate readable BPMN Diagram Interchange (DI) for BPMN 2.0 XML that has no
usable layout information. The result is still a portable `.bpmn` file; this
package is a layout library and CLI, not an image renderer or modeler.

The current implementation covers the project roadmap through Phase 3:

- Loss-aware BPMN parse and serialization
- Deterministic single-process layered layout
- Events, activities, gateways, branches, joins, cycles, and disconnected nodes
- Orthogonal sequence-flow routing
- Pools with a referenced process
- Flat, empty, and nested lanes
- Sequence flows crossing lane boundaries
- BPMN DI shapes, bounds, edges, and waypoints
- Left-to-right and top-to-bottom directions
- Compact, normal, and spacious presets

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

const result = await layoutBpmn(inputXml, {
  direction: 'left-to-right',
  spacing: 'normal',
  diPolicy: 'replace',
});

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

This milestone deliberately stops at Phase 3. It does not yet support:

- Multiple-pool collaboration layout or message-flow routing guarantees
- Boundary events
- Expanded subprocess contents
- Data objects, groups, annotations, or associations
- Label bounds and collision-aware label placement
- Completing or repairing partial DI
- Pinning existing shapes or incremental layout stability

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
