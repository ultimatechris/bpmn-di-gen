import type { Bounds, Point } from './types.js';

export interface OccupiedSegment {
  edgeId?: string;
  start: Point;
  end: Point;
}

export interface OrthogonalRouterOptions {
  /** Distance of candidate tracks on either side of an occupied track. */
  trackSeparation?: number;
  /** Clearance used for the four deterministic outer routing channels. */
  outerMargin?: number;
  lengthCost?: number;
  bendCost?: number;
  crossingCost?: number;
  /** Fixed cost per compressed-grid step that overlaps an existing segment. */
  overlapCost?: number;
  overlapLengthCost?: number;
  maxGridPoints?: number;
  maxVisitedStates?: number;
}

export interface OrthogonalRouteRequest {
  edgeId: string;
  startPort: Point;
  endPort: Point;
  startStub: Point;
  endStub: Point;
  /** Rectangles must already include the desired shape clearance. */
  obstacles: readonly Bounds[];
  occupiedSegments: readonly OccupiedSegment[];
  options?: OrthogonalRouterOptions;
}

interface RouterCosts {
  trackSeparation: number;
  outerMargin: number;
  lengthCost: number;
  bendCost: number;
  crossingCost: number;
  overlapCost: number;
  overlapLengthCost: number;
  maxGridPoints: number;
  maxVisitedStates: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface HeapEntry {
  f: number;
  g: number;
  state: number;
}

const EPSILON = 1e-9;

const DEFAULTS: RouterCosts = {
  trackSeparation: 8,
  outerMargin: 32,
  lengthCost: 1,
  bendCost: 24,
  crossingCost: 2_000,
  overlapCost: 8_000,
  overlapLengthCost: 40,
  maxGridPoints: 250_000,
  maxVisitedStates: 600_000,
};

// A tiny stable heap keeps A* tie-breaking independent of object iteration order.
class MinHeap {
  private readonly values: HeapEntry[] = [];

  get size(): number {
    return this.values.length;
  }

  push(value: HeapEntry): void {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!less(value, this.values[parent])) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): HeapEntry | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!last || this.values.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.values.length) break;
      const right = left + 1;
      let child = left;
      if (right < this.values.length && less(this.values[right], this.values[left])) child = right;
      if (!less(this.values[child], last)) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function less(a: HeapEntry, b: HeapEntry): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.g !== b.g) return a.g < b.g;
  return a.state < b.state;
}

function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function axis(a: Point, b: Point): 0 | 1 | 2 {
  if (samePoint(a, b)) return 0;
  if (a.y === b.y) return 1;
  if (a.x === b.x) return 2;
  return 0;
}

function deduplicate(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (!result.length || !samePoint(result[result.length - 1], point)) result.push({ x: point.x, y: point.y });
  }
  return result;
}

function compress(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of deduplicate(points)) {
    while (result.length >= 2) {
      const a = result[result.length - 2];
      const b = result[result.length - 1];
      if ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)) result.pop();
      else break;
    }
    result.push(point);
  }
  return result;
}

function normalizedCosts(options: OrthogonalRouterOptions | undefined): RouterCosts {
  const positive = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) && value! >= 0 ? value! : fallback;
  return {
    trackSeparation: positive(options?.trackSeparation, DEFAULTS.trackSeparation),
    outerMargin: positive(options?.outerMargin, DEFAULTS.outerMargin),
    lengthCost: positive(options?.lengthCost, DEFAULTS.lengthCost),
    bendCost: positive(options?.bendCost, DEFAULTS.bendCost),
    crossingCost: positive(options?.crossingCost, DEFAULTS.crossingCost),
    overlapCost: positive(options?.overlapCost, DEFAULTS.overlapCost),
    overlapLengthCost: positive(options?.overlapLengthCost, DEFAULTS.overlapLengthCost),
    maxGridPoints: Math.max(16, Math.floor(positive(options?.maxGridPoints, DEFAULTS.maxGridPoints))),
    maxVisitedStates: Math.max(16, Math.floor(positive(options?.maxVisitedStates, DEFAULTS.maxVisitedStates))),
  };
}

function normalizeObstacles(obstacles: readonly Bounds[]): Rect[] {
  const result: Rect[] = [];
  for (const bounds of obstacles) {
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) continue;
    const x2 = bounds.x + bounds.width;
    const y2 = bounds.y + bounds.height;
    const left = Math.min(bounds.x, x2);
    const right = Math.max(bounds.x, x2);
    const top = Math.min(bounds.y, y2);
    const bottom = Math.max(bounds.y, y2);
    if (right - left > EPSILON && bottom - top > EPSILON) result.push({ left, top, right, bottom });
  }
  return result;
}

function usableSegments(edgeId: string, segments: readonly OccupiedSegment[]): OccupiedSegment[] {
  return segments.filter((segment) =>
    segment.edgeId !== edgeId
    && finitePoint(segment.start)
    && finitePoint(segment.end)
    && axis(segment.start, segment.end) !== 0,
  );
}

function addCoordinate(values: Set<number>, value: number): void {
  if (Number.isFinite(value)) values.add(Object.is(value, -0) ? 0 : value);
}

function coordinateIndex(values: readonly number[]): Map<number, number> {
  return new Map(values.map((value, index) => [value, index]));
}

function interior(value: number, minimum: number, maximum: number): boolean {
  return value > minimum + EPSILON && value < maximum - EPSILON;
}

function intervalsOverlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)));
}

function heuristic(x: number, y: number, target: Point, lengthCost: number): number {
  return (Math.abs(target.x - x) + Math.abs(target.y - y)) * lengthCost;
}

function assemble(request: OrthogonalRouteRequest, betweenStubs: readonly Point[]): Point[] {
  const middle = compress(betweenStubs);
  const interiorPoints = middle.length > 2 ? middle.slice(1, -1) : [];
  // Stubs stay explicit even when they are collinear with the adjacent segment.
  return deduplicate([
    request.startPort,
    request.startStub,
    ...interiorPoints,
    request.endStub,
    request.endPort,
  ]);
}

function segmentObstacleHits(a: Point, b: Point, obstacles: readonly Rect[]): number {
  let hits = 0;
  for (const obstacle of obstacles) {
    if (a.y === b.y) {
      if (interior(a.y, obstacle.top, obstacle.bottom)
        && intervalsOverlap(a.x, b.x, obstacle.left, obstacle.right) > EPSILON) hits += 1;
    } else if (a.x === b.x) {
      if (interior(a.x, obstacle.left, obstacle.right)
        && intervalsOverlap(a.y, b.y, obstacle.top, obstacle.bottom) > EPSILON) hits += 1;
    } else {
      hits += 1;
    }
  }
  return hits;
}

function segmentOccupiedCost(
  a: Point,
  b: Point,
  occupied: readonly OccupiedSegment[],
  costs: RouterCosts,
): number {
  const candidateAxis = axis(a, b);
  let cost = 0;
  for (const segment of occupied) {
    const occupiedAxis = axis(segment.start, segment.end);
    if (candidateAxis === occupiedAxis) {
      const collinear = candidateAxis === 1 ? a.y === segment.start.y : a.x === segment.start.x;
      if (!collinear) continue;
      const overlap = candidateAxis === 1
        ? intervalsOverlap(a.x, b.x, segment.start.x, segment.end.x)
        : intervalsOverlap(a.y, b.y, segment.start.y, segment.end.y);
      if (overlap > EPSILON) cost += costs.overlapCost + overlap * costs.overlapLengthCost;
    } else if (candidateAxis === 1 && occupiedAxis === 2) {
      if (segment.start.x >= Math.min(a.x, b.x) - EPSILON
        && segment.start.x <= Math.max(a.x, b.x) + EPSILON
        && a.y >= Math.min(segment.start.y, segment.end.y) - EPSILON
        && a.y <= Math.max(segment.start.y, segment.end.y) + EPSILON) cost += costs.crossingCost;
    } else if (candidateAxis === 2 && occupiedAxis === 1) {
      if (segment.start.y >= Math.min(a.y, b.y) - EPSILON
        && segment.start.y <= Math.max(a.y, b.y) + EPSILON
        && a.x >= Math.min(segment.start.x, segment.end.x) - EPSILON
        && a.x <= Math.max(segment.start.x, segment.end.x) + EPSILON) cost += costs.crossingCost;
    }
  }
  return cost;
}

function fallbackRoute(
  request: OrthogonalRouteRequest,
  obstacles: readonly Rect[],
  occupied: readonly OccupiedSegment[],
  costs: RouterCosts,
  outer: Rect,
): Point[] {
  const start = request.startStub;
  const end = request.endStub;
  const candidates: Point[][] = [];
  if (start.x === end.x || start.y === end.y) candidates.push([start, end]);
  candidates.push([start, { x: end.x, y: start.y }, end]);
  candidates.push([start, { x: start.x, y: end.y }, end]);
  candidates.push([start, { x: start.x, y: outer.top }, { x: end.x, y: outer.top }, end]);
  candidates.push([start, { x: start.x, y: outer.bottom }, { x: end.x, y: outer.bottom }, end]);
  candidates.push([start, { x: outer.left, y: start.y }, { x: outer.left, y: end.y }, end]);
  candidates.push([start, { x: outer.right, y: start.y }, { x: outer.right, y: end.y }, end]);

  let best = compress(candidates[0]);
  let bestHits = Number.POSITIVE_INFINITY;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const raw of candidates) {
    const candidate = compress(raw);
    let hits = 0;
    let cost = 0;
    let previousAxis = axis(request.startPort, request.startStub);
    for (let i = 1; i < candidate.length; i += 1) {
      const currentAxis = axis(candidate[i - 1], candidate[i]);
      hits += segmentObstacleHits(candidate[i - 1], candidate[i], obstacles);
      cost += (Math.abs(candidate[i].x - candidate[i - 1].x) + Math.abs(candidate[i].y - candidate[i - 1].y)) * costs.lengthCost;
      cost += segmentOccupiedCost(candidate[i - 1], candidate[i], occupied, costs);
      if (previousAxis !== 0 && currentAxis !== previousAxis) cost += costs.bendCost;
      previousAxis = currentAxis;
    }
    const finalAxis = axis(request.endStub, request.endPort);
    if (previousAxis !== 0 && finalAxis !== 0 && previousAxis !== finalAxis) cost += costs.bendCost;
    if (hits < bestHits || (hits === bestHits && cost < bestCost - EPSILON)) {
      best = candidate;
      bestHits = hits;
      bestCost = cost;
    }
  }
  return assemble(request, best);
}

/** Route one edge against expanded shape obstacles and edges routed before it. */
export function routeOrthogonal(request: OrthogonalRouteRequest): Point[] {
  if (![request.startPort, request.startStub, request.endStub, request.endPort].every(finitePoint)) {
    throw new TypeError('Orthogonal router points must contain finite coordinates.');
  }

  const costs = normalizedCosts(request.options);
  const obstacles = normalizeObstacles(request.obstacles);
  const occupied = usableSegments(request.edgeId, request.occupiedSegments);
  const xs = new Set<number>([request.startStub.x, request.endStub.x]);
  const ys = new Set<number>([request.startStub.y, request.endStub.y]);

  for (const obstacle of obstacles) {
    addCoordinate(xs, obstacle.left);
    addCoordinate(xs, obstacle.right);
    addCoordinate(ys, obstacle.top);
    addCoordinate(ys, obstacle.bottom);
  }
  for (const segment of occupied) {
    addCoordinate(xs, segment.start.x);
    addCoordinate(xs, segment.end.x);
    addCoordinate(ys, segment.start.y);
    addCoordinate(ys, segment.end.y);
    if (axis(segment.start, segment.end) === 1) {
      addCoordinate(ys, segment.start.y - costs.trackSeparation);
      addCoordinate(ys, segment.start.y + costs.trackSeparation);
      addCoordinate(xs, Math.min(segment.start.x, segment.end.x) - costs.trackSeparation);
      addCoordinate(xs, Math.max(segment.start.x, segment.end.x) + costs.trackSeparation);
    } else {
      addCoordinate(xs, segment.start.x - costs.trackSeparation);
      addCoordinate(xs, segment.start.x + costs.trackSeparation);
      addCoordinate(ys, Math.min(segment.start.y, segment.end.y) - costs.trackSeparation);
      addCoordinate(ys, Math.max(segment.start.y, segment.end.y) + costs.trackSeparation);
    }
  }

  const allX = [...xs];
  const allY = [...ys];
  const margin = Math.max(costs.outerMargin, costs.trackSeparation * 2, 1);
  const outer: Rect = {
    left: Math.min(...allX) - margin,
    right: Math.max(...allX) + margin,
    top: Math.min(...allY) - margin,
    bottom: Math.max(...allY) + margin,
  };
  addCoordinate(xs, outer.left);
  addCoordinate(xs, outer.right);
  addCoordinate(ys, outer.top);
  addCoordinate(ys, outer.bottom);

  const xValues = [...xs].sort((a, b) => a - b);
  const yValues = [...ys].sort((a, b) => a - b);
  const nx = xValues.length;
  const ny = yValues.length;
  const nodeCount = nx * ny;
  if (nodeCount > costs.maxGridPoints) return fallbackRoute(request, obstacles, occupied, costs, outer);

  const xIndex = coordinateIndex(xValues);
  const yIndex = coordinateIndex(yValues);
  const blocked = new Uint8Array(nodeCount);
  const horizontalBlocked = new Uint8Array(Math.max(0, (nx - 1) * ny));
  const verticalBlocked = new Uint8Array(Math.max(0, nx * (ny - 1)));
  const horizontalOverlap = new Uint16Array(horizontalBlocked.length);
  const verticalOverlap = new Uint16Array(verticalBlocked.length);
  const horizontalTrack = new Uint16Array(nodeCount);
  const verticalTrack = new Uint16Array(nodeCount);

  // Obstacle boundaries are legal tracks; only rectangle interiors are forbidden.
  for (const obstacle of obstacles) {
    for (let yi = 0; yi < ny; yi += 1) {
      const y = yValues[yi];
      if (!interior(y, obstacle.top, obstacle.bottom)) continue;
      for (let xi = 0; xi < nx; xi += 1) {
        if (interior(xValues[xi], obstacle.left, obstacle.right)) blocked[yi * nx + xi] = 1;
      }
      for (let xi = 0; xi < nx - 1; xi += 1) {
        if (intervalsOverlap(xValues[xi], xValues[xi + 1], obstacle.left, obstacle.right) > EPSILON) {
          horizontalBlocked[yi * (nx - 1) + xi] = 1;
        }
      }
    }
    for (let xi = 0; xi < nx; xi += 1) {
      if (!interior(xValues[xi], obstacle.left, obstacle.right)) continue;
      for (let yi = 0; yi < ny - 1; yi += 1) {
        if (intervalsOverlap(yValues[yi], yValues[yi + 1], obstacle.top, obstacle.bottom) > EPSILON) {
          verticalBlocked[yi * nx + xi] = 1;
        }
      }
    }
  }

  // Rasterizing occupied segments makes transition scoring O(1) during A*.
  for (const segment of occupied) {
    if (axis(segment.start, segment.end) === 1) {
      const yi = yIndex.get(segment.start.y)!;
      const minimum = Math.min(segment.start.x, segment.end.x);
      const maximum = Math.max(segment.start.x, segment.end.x);
      for (let xi = 0; xi < nx; xi += 1) {
        if (xValues[xi] >= minimum - EPSILON && xValues[xi] <= maximum + EPSILON) horizontalTrack[yi * nx + xi] += 1;
      }
      for (let xi = 0; xi < nx - 1; xi += 1) {
        if (intervalsOverlap(xValues[xi], xValues[xi + 1], minimum, maximum) > EPSILON) {
          horizontalOverlap[yi * (nx - 1) + xi] += 1;
        }
      }
    } else {
      const xi = xIndex.get(segment.start.x)!;
      const minimum = Math.min(segment.start.y, segment.end.y);
      const maximum = Math.max(segment.start.y, segment.end.y);
      for (let yi = 0; yi < ny; yi += 1) {
        if (yValues[yi] >= minimum - EPSILON && yValues[yi] <= maximum + EPSILON) verticalTrack[yi * nx + xi] += 1;
      }
      for (let yi = 0; yi < ny - 1; yi += 1) {
        if (intervalsOverlap(yValues[yi], yValues[yi + 1], minimum, maximum) > EPSILON) {
          verticalOverlap[yi * nx + xi] += 1;
        }
      }
    }
  }

  const startNode = yIndex.get(request.startStub.y)! * nx + xIndex.get(request.startStub.x)!;
  const targetNode = yIndex.get(request.endStub.y)! * nx + xIndex.get(request.endStub.x)!;
  // Several flows may intentionally fan out from the same stub.
  horizontalTrack[startNode] = 0;
  verticalTrack[startNode] = 0;
  horizontalTrack[targetNode] = 0;
  verticalTrack[targetNode] = 0;
  const startAxis = axis(request.startPort, request.startStub);
  const endAxis = axis(request.endStub, request.endPort);
  const stateCount = nodeCount * 3;
  const distances = new Float64Array(stateCount);
  distances.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount);
  previous.fill(-1);
  const startState = startNode * 3 + startAxis;
  distances[startState] = 0;
  const heap = new MinHeap();
  heap.push({
    f: heuristic(request.startStub.x, request.startStub.y, request.endStub, costs.lengthCost),
    g: 0,
    state: startState,
  });

  let visited = 0;
  let bestState = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  const relax = (
    fromState: number,
    toNode: number,
    nextAxis: 1 | 2,
    distance: number,
    overlapCount: number,
    crossingCount: number,
  ): void => {
    const priorAxis = fromState % 3;
    let nextCost = distances[fromState] + distance * costs.lengthCost;
    if (priorAxis !== 0 && priorAxis !== nextAxis) nextCost += costs.bendCost;
    if (overlapCount > 0) {
      nextCost += overlapCount * (costs.overlapCost + distance * costs.overlapLengthCost);
    }
    nextCost += crossingCount * costs.crossingCost * 0.5;
    const nextState = toNode * 3 + nextAxis;
    if (nextCost >= distances[nextState] - EPSILON) return;
    distances[nextState] = nextCost;
    previous[nextState] = fromState;
    const x = xValues[toNode % nx];
    const y = yValues[Math.floor(toNode / nx)];
    heap.push({ f: nextCost + heuristic(x, y, request.endStub, costs.lengthCost), g: nextCost, state: nextState });
  };

  while (heap.size > 0 && visited < costs.maxVisitedStates) {
    const current = heap.pop()!;
    if (current.g > distances[current.state] + EPSILON) continue;
    if (current.f > bestCost + EPSILON) break;
    visited += 1;
    const node = Math.floor(current.state / 3);
    if (node === targetNode) {
      const arrivalAxis = current.state % 3;
      const terminalCost = current.g + (endAxis !== 0 && arrivalAxis !== 0 && endAxis !== arrivalAxis ? costs.bendCost : 0);
      if (terminalCost < bestCost - EPSILON || (Math.abs(terminalCost - bestCost) <= EPSILON && current.state < bestState)) {
        bestCost = terminalCost;
        bestState = current.state;
      }
      continue;
    }

    const xi = node % nx;
    const yi = Math.floor(node / nx);
    // Fixed order plus stable heap ties makes equal-cost routes reproducible.
    if (xi + 1 < nx) {
      const next = node + 1;
      const edge = yi * (nx - 1) + xi;
      if (!blocked[next] && !horizontalBlocked[edge]) {
        relax(current.state, next, 1, xValues[xi + 1] - xValues[xi], horizontalOverlap[edge], verticalTrack[node] + verticalTrack[next]);
      }
    }
    if (yi + 1 < ny) {
      const next = node + nx;
      const edge = yi * nx + xi;
      if (!blocked[next] && !verticalBlocked[edge]) {
        relax(current.state, next, 2, yValues[yi + 1] - yValues[yi], verticalOverlap[edge], horizontalTrack[node] + horizontalTrack[next]);
      }
    }
    if (xi > 0) {
      const next = node - 1;
      const edge = yi * (nx - 1) + xi - 1;
      if (!blocked[next] && !horizontalBlocked[edge]) {
        relax(current.state, next, 1, xValues[xi] - xValues[xi - 1], horizontalOverlap[edge], verticalTrack[node] + verticalTrack[next]);
      }
    }
    if (yi > 0) {
      const next = node - nx;
      const edge = (yi - 1) * nx + xi;
      if (!blocked[next] && !verticalBlocked[edge]) {
        relax(current.state, next, 2, yValues[yi] - yValues[yi - 1], verticalOverlap[edge], horizontalTrack[node] + horizontalTrack[next]);
      }
    }
  }

  if (bestState < 0) return fallbackRoute(request, obstacles, occupied, costs, outer);
  const reversed: Point[] = [];
  for (let state = bestState; state >= 0; state = previous[state]) {
    const node = Math.floor(state / 3);
    reversed.push({ x: xValues[node % nx], y: yValues[Math.floor(node / nx)] });
  }
  reversed.reverse();
  return assemble(request, reversed);
}
