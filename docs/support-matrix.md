# Support Matrix

This matrix describes the Phase 3 implementation, not the eventual roadmap.

| Area | Status | Notes |
| --- | --- | --- |
| BPMN XML without DI | Supported | Generates one diagram and plane |
| Existing DI | Supported by replacement | Existing diagrams are removed |
| Vendor attributes | Preserved | Covered by round-trip tests |
| Extension elements | Preserved | Opaque namespaced content is retained |
| Start, intermediate, and end events | Supported | Boundary events excluded |
| Tasks and activities | Supported | Standard 100 x 80 bounds |
| Gateways | Supported | Standard 50 x 50 bounds |
| Collapsed subprocesses | Supported as activities | Internal contents are not laid out |
| Sequence flows | Supported | Orthogonal forward and backward routes |
| Branches and joins | Supported | Stable layered ranking |
| Cycles | Supported | SCC-based ranking and backward channels |
| Disconnected components | Supported | Stable stacked components |
| Flat lanes | Supported | Lane membership is a hard constraint |
| Empty lanes | Supported | Retain configured minimum size |
| Nested lane sets | Supported | Deepest membership and parent containment |
| One participant and process | Supported | Participant is sized around process/lanes |
| Black-box participant | Not laid out | Planned with collaboration work |
| Multiple pools | Not supported | Phase 4 |
| Message flows | Parsed, best-effort only | Full collaboration routing is Phase 4 |
| Boundary events | Not supported | Semantic element remains in XML |
| Expanded subprocesses | Not supported | Phase 5 |
| Data objects and stores | Not supported | Semantic elements remain in XML |
| Groups, annotations, associations | Not supported | Semantic elements remain in XML |
| Explicit label DI | Not supported | Modelers may render default labels |
| Partial DI completion/repair | Not supported | Replacement only |
| Left-to-right layout | Supported | Default |
| Top-to-bottom layout | Supported | Transposes partitions and direction |
| Spacing presets | Supported | Compact, normal, spacious |
| Node.js API | Supported | Promise-based TypeScript API |
| CLI | Supported | File input and output |

## Diagnostics

| Code | Meaning |
| --- | --- |
| `BPMN_PARSE_WARNING` | The BPMN parser recovered from input content |
| `INVALID_SEQUENCE_FLOW` | A sequence-flow endpoint is unresolved or unsupported |
| `INVALID_MESSAGE_FLOW` | A message-flow endpoint is unresolved |
| `UNRESOLVED_PARTICIPANT_PROCESS` | A participant references a missing process |
| `UNASSIGNED_LANE_NODE` | A flow node has no lane membership and uses the first leaf lane |
| `AMBIGUOUS_LANE_MEMBERSHIP` | A node belongs to multiple lanes at the same depth |
| `UNROUTABLE_MESSAGE_FLOW` | A message-flow endpoint has no generated shape |
| `UNSUPPORTED_ELEMENT` | A preserved BPMN element is outside the Phase 3 layout subset |

Invalid generated DI uses separate invariant diagnostic codes and is raised as a
`BpmnLayoutError` rather than returned as a recoverable result.
