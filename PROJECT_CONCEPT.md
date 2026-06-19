# BPMN DI Auto-Layout

## Implementation Status

Phases 0 through 3 are implemented and verified. The current release provides the
technical foundation, single-process DI generation, and pool/lane-aware layout
described below. See `README.md` and `docs/support-matrix.md` for the executable API
and exact current boundaries.

## Project Idea

Build an open-source tool that accepts a valid BPMN 2.0 XML document with missing,
incomplete, or unusable Diagram Interchange (DI) information and returns a BPMN
2.0 XML document with a clear, standards-compliant layout.

The output remains a `.bpmn` file. The tool does not render the model to an image
and does not replace a BPMN modeler. Its responsibility is to infer a readable
visual arrangement from the semantic process model and encode that arrangement as
BPMN DI shapes, bounds, labels, and edge waypoints.

```text
BPMN semantic model              BPMN semantic model
without usable DI                with generated DI
        |                               ^
        v                               |
  parse and validate -> layout -> write BPMN XML
```

The main problem is not producing coordinates. It is producing coordinates that
respect BPMN semantics and result in a diagram a person can understand.

## Motivation

BPMN permits the process model and its diagram information to be represented
separately. Consequently, BPMN produced by execution engines, converters, process
mining systems, AI generators, and other automated tools may contain no DI at all.
Some files contain only partial or invalid DI.

Existing generic graph layout engines understand nodes, edges, and sometimes
nested containers, but not BPMN-specific rules and conventions. For example:

- A participant is represented as a pool and may reference a process.
- A process may be divided into lanes, including nested lane sets.
- Sequence flows remain within a process but may cross lanes.
- Message flows connect participants rather than nodes in one process.
- Boundary events must remain attached to their activities.
- Expanded subprocesses contain their own internal diagrams.
- Backward flows and loops should remain visible without obscuring the main flow.

A useful solution therefore needs a BPMN-aware layer around, or in place of, a
generic graph layout algorithm.

## Project Goals

1. Generate valid BPMN DI while preserving the semantic BPMN model.
2. Support collaborations, pools, lanes, and message flows as first-class layout
   concepts.
3. Optimize for human readability rather than minimum diagram area alone.
4. Produce deterministic output: identical input and options give identical DI.
5. Handle missing DI and, eventually, repair or complete partial DI.
6. Remain independent of any particular BPMN editor or execution engine.
7. Provide a library API first, with a small CLI for files and automation.

## Non-Goals

- Rendering BPMN to SVG, PNG, PDF, or an interactive canvas.
- Providing a complete BPMN editor or execution engine.
- Changing process behavior to make a model easier to lay out.
- Claiming that one automatic layout is the ideal authoring layout for every
  audience.
- Supporting every BPMN element in the first release.

## Design Principles

### Preserve semantics

IDs, references, extension elements, engine-specific attributes, and executable
behavior must survive the transformation. Except for BPMN DI and explicitly
documented normalization, semantic XML should not change.

### Treat containment as a hard constraint

Pools, lanes, subprocesses, and attached boundary events are not decorative
groups. Their semantic relationships determine where elements may be placed.

### Make readability measurable

Layout quality should be evaluated using explicit metrics and visual fixtures,
including:

- Number of edge crossings
- Number of bends
- Flow-direction violations
- Overlapping shapes, edges, and labels
- Unnecessary lane crossings
- Diagram width, height, and whitespace
- Alignment and spacing consistency
- Proximity of labels to their owners

No single metric is sufficient. A compact diagram with many crossings is not a
good result.

### Prefer predictable conventions

The default layout should use consistent BPMN conventions, such as left-to-right
flow, aligned lanes, stable spacing, and clearly separated message flows. Users
should be able to configure direction and spacing without needing to tune the
underlying layout engine.

### Separate BPMN logic from graph layout

Parsing, semantic analysis, constraint construction, graph layout, BPMN-specific
post-processing, and XML serialization should be separate modules. This allows
layout engines or heuristics to be replaced and evaluated independently.

## Proposed Processing Pipeline

### 1. Parse and preserve the document

Parse BPMN XML into a typed object model while retaining namespaces, extension
elements, and unknown attributes. Identify every existing `BPMNDiagram`,
`BPMNPlane`, `BPMNShape`, `BPMNEdge`, and label.

The parser should report malformed references and unsupported structures rather
than silently dropping them.

### 2. Build a semantic intermediate representation

Convert relevant BPMN concepts into an internal representation designed for
layout:

- Collaborations and participants
- Processes and flow nodes
- Lane sets and lane membership
- Subprocess containment
- Sequence flows and message flows
- Boundary-event attachment
- Data objects, annotations, groups, and associations
- Labels and element-specific preferred sizes

This representation should distinguish hard constraints from layout preferences.

### 3. Normalize and validate relationships

Before layout, resolve references and derive relationships that are implicit or
awkward to query in raw BPMN XML. Examples include assigning each flow node to a
lane, finding participant ownership, identifying graph entry points, classifying
cycles, and establishing subprocess boundaries.

Validation should produce actionable diagnostics but permit layout of recoverable
models where possible.

### 4. Decompose the problem hierarchically

Layout should proceed by semantic level rather than flattening the entire model:

1. Layout nodes within each process or expanded subprocess.
2. Respect lane membership while ordering nodes into ranks or columns.
3. Size lanes around their contents.
4. Size pools around their lane sets or process contents.
5. Arrange pools within the collaboration.
6. Route message flows between pools.
7. Place external artifacts and labels.

This decomposition prevents a generic layout engine from treating pools and lanes
as arbitrary boxes.

### 5. Generate an initial node layout

Transform each layout scope into a constrained graph. A layered algorithm is a
reasonable starting point because BPMN diagrams usually communicate a dominant
flow direction.

The graph layout stage should account for:

- Stable ordering of parallel branches
- Gateway splits and joins
- Cycles and backward edges
- Disconnected components
- Lane membership and cross-lane transitions
- Fixed attachment of boundary events
- Minimum shape and container dimensions

An existing engine such as ELK can be evaluated for this stage, but the public API
should not expose engine-specific data structures.

### 6. Apply BPMN-specific layout refinement

The initial graph layout will require domain-aware post-processing. This stage can
align matching gateways, position boundary events, expand containers, reserve
channels for backward edges, and improve spacing around dense split/join regions.

Refinement rules should be deterministic and tested independently.

### 7. Route edges

Route different BPMN edge types according to their semantics:

- Sequence flows should favor the dominant direction and use few bends.
- Cross-lane sequence flows should cross lane borders cleanly.
- Message flows should travel between pools without appearing to belong to either
  process flow.
- Associations should remain visually subordinate.
- Loop and backward flows should use reserved space where possible.

Waypoints must connect to valid shape borders and must not pass through unrelated
shapes or labels.

### 8. Place labels

Place labels after shapes and primary edge routes are stable. Label placement must
consider the element type, available whitespace, edge segments, and collisions.
It should cover both explicit BPMN labels and labels implied by names.

### 9. Create or update BPMN DI

Generate:

- A `BPMNDiagram` and `BPMNPlane` for the selected process or collaboration
- A `BPMNShape` with bounds for each visible element
- A `BPMNEdge` with waypoints for each visible connection
- Label bounds where required
- Correct references from every DI element to its semantic BPMN element

Three DI policies should eventually be supported:

- `replace`: discard the selected diagram's DI and regenerate it.
- `complete`: preserve valid existing DI and generate only what is missing.
- `repair`: retain useful positioning while fixing invalid or conflicting DI.

The first release should implement `replace`; the other policies require a clear
definition of what existing information is authoritative.

### 10. Serialize and verify

Serialize the complete document back to BPMN XML. Reparse the result and verify
referential integrity, DI coverage, valid bounds and waypoints, and preservation of
semantic elements and extensions.

## Implementation Roadmap

### Phase 0: Research and test corpus

1. Collect a legally redistributable corpus of BPMN files without DI and with
   representative reference layouts.
2. Include straight-line flows, branches, joins, cycles, disconnected nodes,
   boundary events, subprocesses, lanes, multiple pools, and message flows.
3. Add BPMN Model Interchange Working Group examples where licensing permits.
4. Benchmark existing tools, including `bpmn-auto-layout`, ELK-based approaches,
   and any current lane-aware projects.
5. Record their failure modes and define the minimum differentiating feature set.

**Deliverable:** corpus, comparison report, and initial layout-quality rubric.

### Phase 1: Technical foundation

1. Select the implementation language and BPMN parser. TypeScript is a strong
   candidate because of the existing `bpmn-js`, `bpmn-moddle`, and `elkjs`
   ecosystem, but this should be confirmed through a prototype.
2. Define the public library API and CLI contract.
3. Implement loss-aware BPMN parsing and serialization.
4. Define the semantic layout intermediate representation.
5. Add structural validation and diagnostics.
6. Establish unit, snapshot, and visual regression test infrastructure.

**Deliverable:** a round-trip tool that reads and writes BPMN without semantic
loss, although it does not yet generate useful DI.

### Phase 2: Single-process MVP

1. Support events, activities, gateways, and sequence flows.
2. Implement left-to-right layered node placement.
3. Handle branches, joins, simple cycles, and disconnected components.
4. Implement orthogonal sequence-flow routing.
5. Generate complete shape bounds and edge waypoints.
6. Validate the output by importing it into at least two independent BPMN tools.

**Deliverable:** useful DI generation for one process without lanes or expanded
subprocesses.

### Phase 3: Lanes

1. Resolve flow-node membership from `flowNodeRef` values.
2. Represent lanes as hard layout partitions.
3. Order nodes within lanes while maintaining the overall process flow.
4. Route sequence flows across lane boundaries.
5. Calculate lane and pool sizes from content.
6. Support empty lanes and nested lane sets deliberately.
7. Add lane-focused quality metrics and regression fixtures.

**Deliverable:** readable, deterministic layouts for single-pool processes with
lanes.

### Phase 4: Collaborations and pools

1. Support multiple participants and their referenced processes.
2. Support black-box participants.
3. Choose a stable ordering and spacing strategy for pools.
4. Route message flows between participant borders or contained elements.
5. Reduce crossings between message flows and internal process flows.
6. Handle participants whose processes have different sizes and lane counts.

**Deliverable:** complete collaboration layouts with pools, lanes, sequence flows,
and message flows.

### Phase 5: Complex BPMN constructs

Add features based on corpus frequency and user demand:

1. Boundary events and exception flows
2. Collapsed and expanded subprocesses
3. Event subprocesses and transactions
4. Data objects and data stores
5. Text annotations, groups, and associations
6. Conversation and choreography diagrams, if justified
7. Multiple diagrams or planes in one BPMN document

Each construct needs explicit layout semantics and fixtures; unsupported elements
should never disappear silently.

**Deliverable:** broader BPMN coverage with documented support levels.

### Phase 6: Partial DI and layout stability

1. Implement `complete` mode for files with missing DI elements.
2. Implement `repair` mode for malformed or overlapping DI.
3. Allow selected shapes to be pinned as hard constraints.
4. Minimize movement when a model changes incrementally.
5. Preserve intentional manual layout where it remains valid.

**Deliverable:** practical integration into editors, generators, and continuous
model-processing pipelines.

### Phase 7: Performance and release hardening

1. Profile small, medium, and large real-world models.
2. Set performance and memory budgets.
3. Fuzz malformed XML and unusual semantic graphs.
4. Stabilize configuration and diagnostic formats.
5. Publish browser and Node.js packages plus a CLI executable.
6. Document compatibility, limitations, contribution guidelines, and the support
   matrix.

**Deliverable:** a stable initial public release.

## Proposed Public Interface

The exact interface should follow the chosen language, but the conceptual API can
remain small:

```ts
type LayoutOptions = {
  direction?: 'left-to-right' | 'top-to-bottom';
  diPolicy?: 'replace' | 'complete' | 'repair';
  spacing?: 'compact' | 'normal' | 'spacious';
};

type LayoutResult = {
  xml: string;
  diagnostics: Diagnostic[];
  metrics: LayoutMetrics;
};

const result = await layoutBpmn(xml, options);
```

Example CLI usage:

```sh
bpmn-di-gen input.bpmn --output layouted.bpmn
bpmn-di-gen input.bpmn --policy replace --direction left-to-right
```

The API should return diagnostics separately from the XML and should not log or
silently rewrite unsupported content.

## Testing Strategy

### Structural tests

- Every visible semantic element has the expected DI element.
- Every DI reference resolves to a semantic element.
- Bounds have finite, positive dimensions.
- Edges have valid waypoints and meet their source and target shapes.
- Contained shapes remain inside their lane, pool, or subprocess.
- Semantic BPMN content is unchanged after DI generation.

### Layout-quality tests

- No unintended shape overlap
- No edge passing through an unrelated shape
- Bounded edge crossings and bends
- Expected dominant flow direction
- Stable pool and lane ordering
- Consistent spacing and alignment

Quality thresholds should be used where exact coordinates are unnecessarily
brittle.

### Golden and visual regression tests

Store representative input BPMN, expected output BPMN, and rendered previews used
only for test inspection. Rendering is a testing aid, not part of the product API.
Coordinate snapshots catch deterministic changes; image comparisons reveal
readability regressions that structural assertions miss.

### Interoperability tests

Import generated files into multiple independent tools, initially including
`bpmn-js` and at least one other standards-compatible modeler. When possible,
automate import/export round trips and compare semantic models.

### Property and fuzz tests

Generate valid combinations of nodes, containers, and flows to test invariants.
Fuzz XML parsing and reference resolution separately so malformed input produces a
diagnostic rather than data loss or a crash.

## Initial Public Release Acceptance Criteria

The first meaningful release should:

- Accept BPMN 2.0 XML with no DI.
- Preserve all supported semantic elements and extension data.
- Generate a valid diagram for a collaboration with multiple pools and lanes.
- Correctly distinguish sequence flows from message flows.
- Produce no overlapping BPMN shapes in the supported subset.
- Produce deterministic output.
- Open successfully in `bpmn-js` and at least one other BPMN tool.
- Pass structural checks and agreed quality thresholds across the public corpus.
- Report unsupported constructs without omitting them from the semantic model.

## Early Technical Decisions to Validate

Before committing to the implementation architecture, prototypes should answer:

1. Can ELK express lane partitions, nested containers, fixed attachments, and edge
   routing constraints without excessive post-processing?
2. Is `bpmn-moddle` sufficiently loss-aware for required vendor extensions and
   namespace preservation?
3. Should pools be laid out together or individually before collaboration-level
   message-flow routing?
4. Which readability metrics correlate with human judgments on BPMN diagrams?
5. How should conflicting lane membership or invalid cross-pool sequence flows be
   diagnosed?
6. What constitutes valid partial DI, and when is preserving it worse than
   replacing it?

Short experimental branches and documented fixtures should resolve these questions
before a large layout framework is built.

## Open-Source Project Shape

A useful repository should eventually contain:

```text
packages/
  core/             BPMN analysis and layout pipeline
  cli/              command-line interface
  browser/          optional browser-focused bundle
test/
  fixtures/         input models and expected results
  interoperability/ external-tool compatibility tests
  visual/           generated regression previews
docs/
  architecture/     intermediate representation and algorithms
  support-matrix.md supported BPMN and DI constructs
```

The project should publish its corpus, metrics, and known failures. That makes
layout improvements reviewable and gives contributors a precise way to demonstrate
that a change improves readability rather than merely changing coordinates.

## Definition of Success

The project succeeds when BPMN-generating systems can produce a semantic model,
pass it through this tool, and obtain a portable `.bpmn` file that opens as a
readable diagram in standards-compatible tools without manual positioning.
