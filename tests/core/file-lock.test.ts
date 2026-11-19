import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readJsonFile } from '../../src/core/file-lock';

describe('readJsonFile', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'stack-json-'));

  // @req FR:session-inventory/pris.bom
  it('parses a file with and without a leading UTF-8 BOM the same', () => {
    const d = dir();
    const body = JSON.stringify({ a: 1, b: ['x'] });
    writeFileSync(join(d, 'plain.json'), body);
    writeFileSync(join(d, 'bom.json'), `﻿${body}`);
    expect(readJsonFile(join(d, 'bom.json'))).toEqual({ a: 1, b: ['x'] });
    expect(readJsonFile(join(d, 'bom.json'))).toEqual(readJsonFile(join(d, 'plain.json')));
  });

  // @req FR:session-inventory/pris.bom
  it('keeps the error paths: a missing or broken file throws', () => {
    const d = dir();
    expect(() => readJsonFile(join(d, 'none.json'))).toThrow();
    writeFileSync(join(d, 'bad.json'), '﻿{bad');
    expect(() => readJsonFile(join(d, 'bad.json'))).toThrow();
  });
});
