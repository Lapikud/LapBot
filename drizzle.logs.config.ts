import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/integrations/logging/table.ts',
  out: './drizzle/logs',
});
