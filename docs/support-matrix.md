# Support Matrix

This matrix describes the Phase 6 (current) implementation.

| Area | Status | Notes |
| --- | --- | --- |
| BPMN XML without DI | Supported | Generates one collaboration diagram, or one diagram per standalone process |
| Existing DI | Supported | Replace, complete, and repair policies control preservation |
| Vendor attributes | Preserved | Covered by round-trip tests |
| Extension elements | Preserved | Opaque namespaced content is retained |
| Start, intermediate, and end events | Supported | Standard 36 x 36 bounds |
| Boundary events | Supported | Placed on host border; exception flows route below host |
| Tasks and activities | Supported | Standard 100 x 80 bounds |
| Gateways | Supported | Standard 50 x 50 bounds |
| Collapsed subprocesses | Supported as activities | Internal contents not expanded |
| Expanded subprocesses | Supported | Child elements laid out recursively inside the subprocess shape; nesting deeper than 256 levels is rejected |
| Sequence flows | Supported | Orthogonal forward and backward routes |
| Branches and joins | Supported | Stable layered ranking |
| Cycles | Supported | SCC-based ranking and backward channels |
| Disconnected components | Supported | Stable stacked components |
| Text annotations | Supported | Placed beside process content; association routed |
| Associations | Supported | Straight line between source and target |
| Data objects | Supported | DataObjectReference and DataStoreReference placed beside a connected task |
| Data associations | Supported | Routed between task and data element |
| Groups | Supported | Bounding box around member nodes (or all nodes if unresolved) |
| Flat lanes | Supported | Lane membership is a hard constraint |
| Empty lanes | Supported | Retain configured minimum size |
| Nested lane sets | Supported | Deepest membership and parent containment |
| Multiple standalone processes | Supported | Each process receives its own diagram plane |
| One participant and process | Supported | Participant is sized around process/lanes |
| Black-box participants | Supported | Sized to collaboration width; stacked in declaration order |
| Multiple pools | Supported | Stacked vertically in collaboration order |
| Message flows | Supported | Routed between generated participant or flow-node shapes, including expanded subprocess contents |
| Explicit label DI | Not supported | Modelers may render default labels |
| DI policy: replace | Supported | Default — discards existing DI and generates fresh |
| DI policy: complete | Supported | Preserves valid existing shape positions and edge routes; generates missing DI |
| DI policy: repair | Supported | Restores valid existing shapes; re-routes all edges |
| Element pinning (`pins`) | Supported | Specified element IDs keep valid existing shape positions or edge routes |
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
| `UNSUPPORTED_ELEMENT` | A preserved BPMN element is outside the current layout subset |
| `UNRESOLVED_GROUP_MEMBERS` | A group category resolves to no flow nodes, so all graph nodes are used |

Invalid generated DI uses separate invariant diagnostic codes and is raised as a
`BpmnLayoutError` rather than returned as a recoverable result.
