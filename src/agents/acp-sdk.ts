/**
 * Loads the ACP SDK on first use. The SDK is ESM-only, so this is a native `import()`: under `module: commonjs` tsc would turn a plain
 * `import()` into `require()`, which cannot load it. Tests replace this module (the test runner compiles the SDK to CommonJS instead).
 * @req NFR:acp-driver/acp.lazy
 */
import type * as Acp from '@agentclientprotocol/sdk';

export type AcpSdk = typeof Acp;
const nativeImport = new Function('m', 'return import(m)') as (m: string) => Promise<AcpSdk>;
let loaded: Promise<AcpSdk> | undefined;
export const loadAcpSdk = (): Promise<AcpSdk> => (loaded ??= nativeImport('@agentclientprotocol/sdk'));
