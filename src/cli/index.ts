#!/usr/bin/env node
import { run } from './run';

// @req FR:cli/run.bin (declared in package.json bin; this file is the target and carries the shebang)
run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
