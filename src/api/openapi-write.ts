/** Writes docs/api/openapi.yaml (`pnpm openapi`). @req FR:api/docs.openapi */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { renderOpenApi } from './openapi';

writeFileSync(join(__dirname, '../../docs/api/openapi.yaml'), renderOpenApi());
