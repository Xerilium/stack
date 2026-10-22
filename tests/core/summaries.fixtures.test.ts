import * as fs from 'fs';
import * as path from 'path';
import { FILES, expectedOrNull, runCase, runsOf } from '../parity/helpers';

/**
 * Byte-for-byte parity with the legacy PowerShell generator on committed fixtures.
 * Regenerate expected files with tests/parity/generate-legacy.ps1 (see the spec, Legacy Parity).
 */
const root = path.join(__dirname, '../fixtures/summaries');

for (const name of fs.readdirSync(root)) {
  describe(`legacy parity: ${name}`, () => {
    for (const run of runsOf(path.join(root, name))) {
      describe(run.label, () => {
        const out = runCase(path.join(root, name), run.now);
        for (const [key, file] of FILES) {
          // @req FR:summaries/parity.fixture @req FR:summaries/parity.quirks
          // @req FR:summaries/generate.@function @req FR:summaries/generate.input @req FR:summaries/generate.rank
          // @req FR:summaries/stack.header @req FR:summaries/stack.tasks @req FR:summaries/stack.breakdown
          // @req FR:summaries/readme.top @req FR:summaries/readme.other @req FR:summaries/projects.sections
          // @req FR:summaries/myday.finished @req FR:summaries/$summary-input @req FR:summaries/$summary-files
          it(`${file} is byte-identical`, () => {
            expect(out[key]).toBe(expectedOrNull(run, file));
          });
        }
      });
    }
  });
}
