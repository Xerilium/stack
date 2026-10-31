import { describe, it } from 'vitest';

/** Web-shell requirements a human checks: each skip says what to look for and why no test does it. */
describe('web-shell: human checks', () => {
  // @req FR:web-shell/palette.jump.scroll — cannot be automated: no existing test arrows past the visible palette list; check that the selected command stays in view while the list scrolls
  it.skip('the palette list scrolls and keeps the selected command in view', () => undefined);
});
