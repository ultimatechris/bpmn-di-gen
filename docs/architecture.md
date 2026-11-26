# Architecture

## Pipeline

```text
BPMN XML
  -> bpmn-moddle parse
  -> semantic analysis and diagnostics
  -> layout intermediate representation
  -> SCC condensation and deterministic ranking
  -> node, lane, and participant placement
  -> orthogonal edge routing
  -> BPMN DI construction
  -> BPMN XML serialization
  -> independent reparse and DI invariant checks
```

`src/index.ts` owns the public API and pipeline. The stages remain separate so the
ranking or placement strategy can change without coupling XML handling to layout.

## Semantic Analysis

`src/analyze.ts` extracts supported flow nodes, sequence flows, participants, and
recursive lane sets. References are resolved before layout. Invalid endpoints and
ambiguous lane membership produce stable diagnostic codes.

The source moddle elements remain attached to intermediate objects. DI creation can
therefore reference the original semantic objects without reconstructing or
normalizing the process model.

## Ranking

`src/rank.ts` applies Tarjan's strongly connected component algorithm. Components
are condensed into a DAG and assigned longest-path ranks in stable source order.
Nodes inside a cyclic component receive consecutive ranks. An outgoing edge uses
its source node's offset within the component to keep downstream nodes ahead of
their predecessors. Edges returning to an equal or earlier rank are classified
as backward flows.

This provides deterministic results for cycles while preserving a dominant forward
direction for the rest of the process.

## Placement

`src/layout.ts` lays out one process graph at a time.

Without lanes, nodes in the same rank are stacked around the process centerline.
With lanes, recursive lane sets are reduced to ordered leaf partitions. Each node
uses its deepest lane membership; nodes assigned only to a parent use its first
leaf descendant. Leaf height is based on the maximum simultaneous content in any
rank, with a configured minimum for empty lanes. Parent bounds are the union of
their direct children.

Node columns use the maximum supported node width plus the selected rank gap.
Top-to-bottom layout transposes the coordinates and dimensions of generated shapes.

## Routing

`src/ports.ts` assigns deterministic, separated connection points when several
flows share a node side. Short forward flows use the natural outgoing and incoming
sides; blocked same-row flows can leave from the top or bottom instead of crossing
an intervening node.

`src/router.ts` builds a sparse rectilinear visibility grid around expanded shape
bounds and searches it with A*. Shape interiors are hard obstacles. Route cost
combines length and bends with much larger penalties for crossing or sharing an
already occupied segment. Previously routed sequence flows and participant stubs
therefore reserve their tracks for subsequent sequence and message flows.

Sequence and message flows use the same obstacle-aware router. Routes are generated
in a stable order, duplicate waypoints are removed, and top-to-bottom layout reuses
the same algorithm through coordinate transposition. Crossings can still be
unavoidable for non-planar graphs or externally pinned geometry, but overlapping
tracks and paths through unrelated shapes are excluded whenever a valid orthogonal
route exists.

## DI Generation

`src/di.ts` writes one `BPMNDiagram` and `BPMNPlane` for a collaboration, or one
pair for each standalone process in a document without a collaboration. It
creates shapes in containment order, then edges.
Generated IDs are checked against all semantic and DI IDs to avoid XML ID
collisions.

`src/validate.ts` verifies after serialization and reparse that:

- A diagram and plane exist
- Every DI element references a semantic BPMN element
- Every shape has finite positive bounds
- Every edge has at least two finite waypoints

Failure raises `BpmnLayoutError`; invalid output is never returned as success.

## Determinism

Semantic source order is the primary stable ordering, with BPMN IDs as a tie
breaker. No random values, timestamps, object hashes, or environment-dependent IDs
enter the output. Exact XML equality is covered by tests.
