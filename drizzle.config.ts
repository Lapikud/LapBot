import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/infra/db/**/model.ts',
    './src/infra/db/settings/repo.ts',
    './src/features/*/schema.ts',
  ],
  out: './drizzle',
});
