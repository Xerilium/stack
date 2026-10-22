#!/usr/bin/env node
import { run } from './run';

/** @req FR:cli/run.bin (package.json bin -> dist/cli/index.js; this file carries the node shebang) */
run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
