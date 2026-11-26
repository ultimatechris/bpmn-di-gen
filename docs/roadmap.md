# bpmn-di-gen roadmap to 1.0

Version 0.1.1 generates Diagram Interchange (DI) for BPMN 2.0 files and can complete
or repair existing layouts. The goal for 1.0 is a stable Node.js API and CLI that
produce readable diagrams and preserve the process model for a documented set of
BPMN constructs. The [support matrix](support-matrix.md) describes current coverage.

## 0.1.x compatibility baseline

- The [browser import tests](../test/interoperability.test.ts) cover processes,
  lanes, collaborations with message flows, expanded subprocesses, boundary
  events, and partial DI in both layout directions.
- Add checks for semantic round-trips, containment, and preserved geometry in
  both layout directions. For partial DI, cover the differences between
  `complete` and `repair` when shapes or routes are pinned.
- Show one before-and-after diagram in the README and link to the input BPMN so
  readers can reproduce it with the CLI.

Land these improvements as they are ready. Publish a 0.1 patch when there is a
compatible layout, CLI, or security fix that benefits npm users.

## 0.2.0 readable flow labels

Generate `BPMNLabel` bounds for named sequence and message flows. Start with
gateway branches so readers can see which condition belongs to each path.

- Place labels near their own flow and test clearance from task shapes and other
  labels on representative diagrams. Report cases where the available space
  prevents useful placement.
- Preserve valid saved label bounds in `complete` mode. In `repair` mode, place
  labels for rerouted flows against the new waypoints.
- Verify that labels import and render in both directions. Use the same named
  flow fixtures to check that repeated runs place labels consistently.

## 0.3.0 CLI for automated workflows

- Add `--json` so CI and scripts can consume diagnostic codes, affected BPMN
  element IDs, and layout metrics when available.
- Add a read-only `--check` command for missing or invalid DI. Define and test
  distinct exit statuses for usable DI, DI that needs work, and invalid BPMN input.
- Document one pipeline example that checks a generated BPMN model, lays it out
  when needed, and consumes the structured diagnostics.

## 0.4.0 reliable partial layouts and larger diagrams

- Place new elements around saved geometry while respecting lane, pool, and
  subprocess boundaries. When fixed positions make those constraints incompatible,
  surface a diagnostic so the caller can make a decision.
- Cover crowded lanes, moved or pinned containers, and nested subprocesses in
  regression tests. Compare saved bounds and routes directly for each DI policy.
- Benchmark small, medium, and large shareable models in a documented environment.
  Record diagram size, elapsed time, and peak memory. Use the results to set and
  test limits for unusually large or deeply nested inputs.

## 1.0.0 compatibility commitment

Document the public contract for `layoutBpmn`, its options and return value,
diagnostic codes, and CLI flags and exit statuses. State the supported Node.js
versions and DI policies. The same input and options should produce the same XML
within a release. Generated coordinates may evolve as layout quality improves.

Tag 1.0.0 when all of the following are true.

- The compatibility corpus passes structural and round-trip checks in CI, and
  its documented examples import into `bpmn-js` and one independent BPMN importer.
- The support matrix matches the tested constructs, preservation rules, and
  diagnostics. The README shows installation, CLI and API usage, and one way to
  report a reproducible layout bug.
- A clean install from the release tarball runs the API and CLI examples. CI and
  the dependency audit pass, and the changelog describes the stable contract and
  any migration steps from 0.x.

Batch related changes and ship urgent fixes when they are ready. During 0.x, use
a minor bump for a new capability or an intentional compatibility break, and
describe migration steps where they apply. Follow the
[tag-based release process](../README.md#releasing) and use
[Semantic Versioning](https://semver.org/) for the published contract.
