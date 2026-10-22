import * as fs from 'fs';
import * as path from 'path';
import { parseConfig } from '../../src/core/config';
import { generateSummaries, type SummaryFiles } from '../../src/core/summaries';

export const FILES: [keyof SummaryFiles, string][] = [
  ['readme', 'README.md'], ['stack', 'stack.md'], ['projects', 'projects.md'], ['myDay', 'my-day.md'],
];

const read = (p: string): string | undefined => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined);

export interface ParityRun { label: string; now: Date; expectedDir: string }

/** One run per `now*.txt` in the case directory (layout: tests/parity/generate-legacy.ps1). */
export function runsOf(dir: string): ParityRun[] {
  return fs.readdirSync(dir).filter(f => /^now(-.*)?\.txt$/.test(f)).sort().map(f => {
    const label = f.replace(/^now-?/, '').replace(/\.txt$/, '');
    return {
      label: label || 'default',
      now: new Date(fs.readFileSync(path.join(dir, f), 'utf8').trim()),
      expectedDir: label ? path.join(dir, 'expected', label) : path.join(dir, 'expected'),
    };
  });
}

/** Runs the TypeScript generator over a parity case directory at one instant. */
export function runCase(dir: string, now: Date): SummaryFiles {
  const tasks = path.join(dir, 'tasks');
  const cfg = read(path.join(dir, '.xe/config/stack.json'));
  return generateSummaries({
    projects: fs.readdirSync(tasks).filter(f => f.endsWith('.md')).map(f => ({ fileName: f, content: fs.readFileSync(path.join(tasks, f), 'utf8') })),
    config: parseConfig(cfg ? JSON.parse(cfg) : undefined),
    now,
    previousReadme: read(path.join(dir, 'prior/README.md'))?.replace(/^﻿/, ''),
    previousProjects: read(path.join(dir, 'prior/projects.md'))?.replace(/^﻿/, ''),
  });
}


/** Expected text of a file, or null when legacy did not write it. */
export const expectedOrNull = (run: ParityRun, file: string): string | null => {
  const p = path.join(run.expectedDir, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};
