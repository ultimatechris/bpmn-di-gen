#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { BpmnLayoutError, layoutBpmn } from './index.js';
import type { DiPolicy, LayoutDirection, LayoutSpacing } from './types.js';

interface CliOptions {
  input?: string;
  output?: string;
  direction?: LayoutDirection;
  spacing?: LayoutSpacing;
  diPolicy?: DiPolicy;
}

function usage(): string {
  return `Usage: bpmn-di-gen <input.bpmn> --output <output.bpmn> [options]

Options:
  -o, --output <file>       Output BPMN file (required)
  --direction <direction>   left-to-right (default) or top-to-bottom
  --spacing <spacing>       compact, normal (default), or spacious
  --di-policy <policy>      replace (default), complete, or repair
  -h, --help                Show this help`;
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '-h' || value === '--help') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else if (value === '-o' || value === '--output') {
      options.output = args[++index];
    } else if (value === '--direction') {
      options.direction = args[++index] as LayoutDirection;
    } else if (value === '--spacing') {
      options.spacing = args[++index] as LayoutSpacing;
    } else if (value === '--di-policy') {
      options.diPolicy = args[++index] as DiPolicy;
    } else if (value.startsWith('-')) {
      throw new Error(`Unknown option: ${value}`);
    } else if (!options.input) {
      options.input = value;
    } else {
      throw new Error(`Unexpected argument: ${value}`);
    }
  }
  if (!options.input || !options.output) throw new Error('An input file and --output are required.');
  return options;
}

async function main(): Promise<void> {
  try {
    const options = parseArguments(process.argv.slice(2));
    const xml = await readFile(options.input!, 'utf8');
    const result = await layoutBpmn(xml, {
      direction: options.direction,
      spacing: options.spacing,
      diPolicy: options.diPolicy,
    });
    await writeFile(options.output!, result.xml, 'utf8');
    process.stderr.write(
      `${basename(options.output!)}: ${result.metrics.shapeCount} shapes, ${result.metrics.edgeCount} edges, `
      + `${result.diagnostics.length} diagnostics\n`,
    );
  } catch (error) {
    const details = error instanceof BpmnLayoutError && error.diagnostics.length
      ? `\n${error.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n')}`
      : '';
    process.stderr.write(`bpmn-di-gen: ${(error as Error).message}${details}\n`);
    process.exitCode = 1;
  }
}

await main();
