import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/integrations/db/*/table.ts',
  out: './drizzle',
});
