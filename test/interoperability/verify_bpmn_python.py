#!/usr/bin/env python3
"""Import generated BPMN with the independent bpmn-python implementation."""

import sys

import networkx as nx

# bpmn-python 0.0.18 uses the NetworkX 1.x compatibility attributes.
nx.Graph.node = property(lambda graph: graph._node)
nx.Graph.edge = property(lambda graph: graph._adj)

from bpmn_python.bpmn_diagram_import import BpmnDiagramGraphImport
from bpmn_python.bpmn_diagram_rep import BpmnDiagramGraph


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_bpmn_python.py <layouted.bpmn>")
    diagram = BpmnDiagramGraph()
    BpmnDiagramGraphImport.load_diagram_from_xml(sys.argv[1], diagram)
    print(f"nodes={len(diagram.diagram_graph.nodes())} edges={len(diagram.diagram_graph.edges())}")


if __name__ == "__main__":
    main()
