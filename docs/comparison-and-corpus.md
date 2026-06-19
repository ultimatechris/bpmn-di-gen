# Phase 0 Comparison and Corpus

## Question

The initial investigation tested whether an existing open-source tool already
provided lane-aware BPMN DI generation from semantic BPMN XML.

## Existing Tools

### bpmn-auto-layout

`bpmn-auto-layout` was executed against all three initial fixtures on 2026-06-19.
It completed without throwing, but generated no lane shapes for either lane fixture
and no participant shape for the collaboration fixture.

| Fixture | Completed | Lane shapes | Participant shapes |
| --- | ---: | ---: | ---: |
| `single-process.bpmn` | Yes | 0 | 0 |
| `lanes.bpmn` | Yes | 0 | 0 |
| `nested-lanes.bpmn` | Yes | 0 | 0 |

This confirms the relevant gap: successful XML output is not sufficient when the
semantic containers have no DI.

### Generic graph layout

ELK is suitable for layered ranks and compound graphs, but BPMN lane membership,
participant sizing, boundary attachments, and BPMN DI serialization remain domain
responsibilities. Phase 1 therefore keeps graph layout behind a BPMN-specific
intermediate representation. The Phase 2–3 implementation uses an internal
deterministic algorithm so these constraints can be tested directly.

### bpmn-elk-layout

The package describes conversion from its own ELK-BPMN JSON representation to BPMN
XML. It does not provide the same raw BPMN-without-DI input contract, so it was not
used as the implementation base. Its behavior should be reevaluated as that project
matures.

## Initial Corpus

The redistributable corpus is stored in `test/fixtures`:

| Fixture | Coverage |
| --- | --- |
| `single-process.bpmn` | Existing bad DI, events, tasks, gateway split, cycle, backward flow, vendor attributes |
| `lanes.bpmn` | Collaboration plane, participant, four flat lanes, empty lane, cross-lane sequence flows |
| `nested-lanes.bpmn` | Recursive lane set, parent containment, cross-child-lane flow |
| `future-constructs.bpmn` | Black-box and process pools, message flow, expanded subprocess, boundary event; retained for later phases |

Additional generated cases in tests cover malformed XML, an empty process,
unassigned lane membership, arbitrary extension elements, and disconnected
components.

This is a focused engineering corpus for Phases 1–3, not yet a representative
real-world benchmark corpus. More externally sourced models are needed before
making broad layout-quality claims.

## Current Measurements

On the development machine, 20 sequential runs per fixture produced:

| Fixture | Shapes | Edges | Size | Mean runtime |
| --- | ---: | ---: | --- | ---: |
| `single-process.bpmn` | 6 | 6 | 876 x 200 | 9.61 ms |
| `lanes.bpmn` | 11 | 5 | 1320 x 590 | 7.96 ms |
| `nested-lanes.bpmn` | 7 | 3 | 900 x 300 | 7.16 ms |

These timings include parse, layout, serialization, reparse, and structural
verification. They are baseline observations, not formal performance guarantees.

## Phase 3 Quality Rubric

The automated gate currently requires:

- No overlapping flow-node shapes in representative branching and disconnected models
- Every lane-owned node contained by the expected semantic lane
- Every child lane contained by its parent lane
- Every lane contained by its participant where a participant exists
- Empty lanes retain positive usable bounds
- Every supported edge has at least two finite waypoints
- Backward-flow channels remain above unpooled process nodes
- Exact deterministic XML for repeated calls
- Semantic names, execution flags, vendor attributes, and extension elements survive
- All primary fixtures import into `bpmn-js` with zero warnings
- Generated lane DI imports into the independent `bpmn-python` model with six nodes and five edges
- Reviewed visual baselines remain byte-identical

Later phases should add crossing counts, obstacle-intersection metrics, label
collisions, and a larger human-rated corpus.
