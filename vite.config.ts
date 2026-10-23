import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { labApi } from './vite-plugin-api.ts';

/**
 * The published @digo-labs packages declare a `development` export condition
 * pointing at `./src`, which npm does not ship. Dropping that condition makes
 * Vite resolve them through `import`/`default`, i.e. their built files.
 */
const conditions = ['module', 'browser', 'production'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss(), labApi({ FAL_KEY: env.FAL_KEY, DAYDREAM_API_KEY: env.DAYDREAM_API_KEY })],
    resolve: { conditions },
    server: { port: 5178 },
  };
});
