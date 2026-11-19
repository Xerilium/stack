import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Tests never read the developer's gh sign-in or call GitHub with it. A test that needs gh injects a fake. @req FR:pr-page/auth.token
process.env.STACK_GH_AUTH ??= 'off';
// Tests never read the developer's live state (~/.stack: pris.json and the rest). A test that needs it sets STACK_HOME.
process.env.STACK_HOME = mkdtempSync(join(tmpdir(), 'stack-test-home-'));
// Tests never read the developer's Claude session store: by default it is a folder that does not exist, so the agent dead-link lint skips.
process.env.STACK_SESSIONS_DIR ??= join(tmpdir(), `stack-test-no-sessions-${process.pid}`);
