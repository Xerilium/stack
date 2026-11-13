import { readFileSync } from 'fs';
import { join } from 'path';

const doc = readFileSync(join(__dirname, '../../docs/live-validation-agent.md'), 'utf8');

describe('docs/live-validation-agent.md', () => {
  // @req FR:pr-review-lane/contract.doc
  it('is at most 50 lines and gives the loop with the real commands', () => {
    expect(doc.trimEnd().split('\n').length).toBeLessThanOrEqual(50);
    for (const s of ['stack live next', 'stack live checklist', 'stack live ready', 'stack live state', 'stack live item fixed', 'stack live item block', 'stack live resolve', '5173-5182', 'Never use 5180', 'Send no report']) expect(doc).toContain(s);
  });
  // @req FR:pr-review-lane/contract.guard
  it('states the guards: holds, Autopilot, acks, merge, locks', () => {
    expect(doc).toMatch(/Never resolve, reply to, or edit a review thread on which the owner wrote a hold/);
    expect(doc).toMatch(/Never apply the Autopilot label/);
    expect(doc).toMatch(/stack pr-pri ack` only with the owner's own ack record/);
    expect(doc).toMatch(/Never merge/);
    expect(doc).toMatch(/Never take a server lock that another owner holds/);
  });
});
