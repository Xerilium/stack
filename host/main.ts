import { app } from '@azure/functions';
import type { AzureAppLike } from '../src/api';
import { registerHost } from '../src/host';

// The adapter's structural app type is narrower than the SDK's; the shapes are compatible at runtime.
registerHost(app as unknown as AzureAppLike, process.env, { log: (line) => console.log(line) });
