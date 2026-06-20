import type { Diagnostic } from './types.js';

export class BpmnLayoutError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(message: string, diagnostics: Diagnostic[] = [], options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BpmnLayoutError';
    this.diagnostics = diagnostics;
  }
}
