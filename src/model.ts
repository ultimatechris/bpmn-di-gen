import type { Bounds, Diagnostic, Point } from './types.js';

export interface LayoutBoundaryEvent {
  id: string;
  type: string;
  element: any;
  hostId: string;
  width: number;
  height: number;
  bounds?: Bounds;
}

export interface LayoutNode {
  id: string;
  type: string;
  element: any;
  width: number;
  height: number;
  laneId?: string;
  rank: number;
  order: number;
  bounds?: Bounds;
}

export interface LayoutEdge {
  id: string;
  type: 'sequence' | 'message';
  element: any;
  sourceId: string;
  targetId: string;
  points?: Point[];
  backward: boolean;
}

export interface LayoutLane {
  id: string;
  element: any;
  parentId?: string;
  childIds: string[];
  nodeIds: string[];
  depth: number;
  bounds?: Bounds;
}

export interface LayoutParticipant {
  id: string;
  element: any;
  processId?: string;
  bounds?: Bounds;
  participantOrder: number;
}

export interface ProcessGraph {
  process: any;
  participant?: LayoutParticipant;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  lanes: LayoutLane[];
  roots: string[];
  width: number;
  height: number;
  participantOrder: number;
  boundaryEvents: LayoutBoundaryEvent[];
}

export interface LayoutModel {
  definitions: any;
  planeElement: any;
  collaboration?: any;
  graphs: ProcessGraph[];
  messageEdges: LayoutEdge[];
  diagnostics: Diagnostic[];
  blackBoxParticipants: LayoutParticipant[];
}
