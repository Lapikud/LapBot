import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/core/**/schema.ts',
    './src/core/guild-settings.ts',
    './src/features/*/schema.ts',
  ],
  out: './drizzle',
});
