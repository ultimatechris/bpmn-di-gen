# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-26

### Fixed

- Preserve collapsed subprocesses and avoid overlapping saved task positions when
  completing or repairing existing diagrams.
- Separate boundary events attached to the same activity, correct the direction
  of data input associations, and route cycle exits forward.

### Security

- Update the development test dependencies to clear known vulnerabilities.
- Run release checks and build the npm tarball in a separate job from publishing.

## [0.1.0] - 2026-08-08

### Added

- Deterministic BPMN DI generation for processes, collaborations, pools, lanes,
  expanded subprocesses, boundary events, artifacts, and message flows.
- Obstacle-aware orthogonal routing with separated and participant-aligned ports.
- Replace, complete, and repair policies for existing Diagram Interchange data.
- Node.js API, command-line interface, structured diagnostics, and layout metrics.
- Structural, interoperability, performance, routing, and visual regression tests.

### Security

- Production and development dependencies audited with no known vulnerabilities.
