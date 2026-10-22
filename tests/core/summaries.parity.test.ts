import { FILES, expectedOrNull, runCase, runsOf } from '../parity/helpers';

/**
 * Compares the generator with the legacy PowerShell output for any case directory.
 * Set STACK_LEGACY_DIR to a directory laid out as in tests/parity/generate-legacy.ps1 (with `expected/` filled in).
 */
const dir = process.env.STACK_LEGACY_DIR;
const suite = dir ? describe : describe.skip;

suite('legacy parity (STACK_LEGACY_DIR)', () => {
  for (const run of dir ? runsOf(dir) : []) {
    describe(run.label, () => {
      const out = runCase(dir!, run.now);
      for (const [key, file] of FILES) {
        // @req FR:summaries/parity.env
        it(`${file} is byte-identical`, () => {
          expect(out[key]).toBe(expectedOrNull(run, file));
        });
      }
    });
  }
  if (!dir) it.skip('needs STACK_LEGACY_DIR', () => undefined);
});
