export type LayoutDirection = 'left-to-right' | 'top-to-bottom';
export type DiPolicy = 'replace' | 'complete' | 'repair';
export type LayoutSpacing = 'compact' | 'normal' | 'spacious';

export interface LayoutOptions {
  direction?: LayoutDirection;
  diPolicy?: DiPolicy;
  spacing?: LayoutSpacing;
  /** Element IDs whose existing DI positions are preserved regardless of policy. */
  pins?: string[];
}

export interface Diagnostic {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  elementId?: string;
}

export interface LayoutMetrics {
  shapeCount: number;
  edgeCount: number;
  laneCount: number;
  participantCount: number;
  width: number;
  height: number;
  backwardEdgeCount: number;
}

export interface LayoutResult {
  xml: string;
  diagnostics: Diagnostic[];
  metrics: LayoutMetrics;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}
