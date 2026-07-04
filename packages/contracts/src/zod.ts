import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Augment Zod with `.openapi()` so schemas double as the OpenAPI source of
// truth. This mutates the shared `z`, so every schema in this package must
// import `z` from here rather than from 'zod' directly.
extendZodWithOpenApi(z);

export { z };
