import { version } from '../src/index';
import { version as pkgVersion } from '../package.json';

describe('Stack', () => {
  it('should export version from package.json', () => {
    expect(version).toBe(pkgVersion);
  });
});
