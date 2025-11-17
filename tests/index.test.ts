import { version } from '../src/index';

describe('Stack', () => {
  it('should export version', () => {
    expect(version).toBe('0.0.1');
  });
});
