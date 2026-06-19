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
Nodes inside a cyclic component receive consecutive ranks; edges returning to an
equal or earlier rank are classified as backward flows.

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
Native BPMN element dimensions are retained when switching direction.

## Routing

Forward sequence flows leave the right border and enter the left border in the
default direction. A midpoint channel provides orthogonal routing across lanes.
Backward flows receive deterministic channels above process content. Duplicate
waypoints are removed.

Routing is intentionally separate from placement. Future obstacle avoidance and
message-flow routing can replace this stage without changing semantic analysis.

## DI Generation

`src/di.ts` replaces the document's diagram collection with one generated
`BPMNDiagram` and `BPMNPlane`. It creates shapes in containment order, then edges.
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
