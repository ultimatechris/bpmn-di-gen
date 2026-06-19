import type { Diagnostic } from './types.js';

export class BpmnLayoutError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = 'BpmnLayoutError';
    this.diagnostics = diagnostics;
  }
}
