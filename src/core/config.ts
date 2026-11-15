import { IANAZone } from 'luxon';
import { z } from 'zod';

// Blank values in .env files arrive as '' and mean "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional(),
  );

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: optional(snowflake),
  DISCORD_GUILD_ID: optional(snowflake),

  DATABASE_URL: z.url(),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DEFAULT_TIMEZONE: z
    .string()
    .default('Europe/Tallinn')
    .refine((zone) => IANAZone.isValidZone(zone), 'must be an IANA timezone'),

  ROLE_SELECTION_CHANNEL_ID: optional(snowflake),
  TARKVARA_ROLE_ID: optional(snowflake),
  HELPDESK_ROLE_ID: optional(snowflake),
  KULTUUR_ROLE_ID: optional(snowflake),

  REDMINE_BASE_URL: optional(z.url()),
  REDMINE_API_KEY: optional(z.string().min(1)),
  CREDENTIAL_ENCRYPTION_KEY: optional(
    z
      .string()
      .refine(
        (key) => Buffer.from(key, 'base64').length === 32,
        'must be 32 bytes encoded as base64',
      ),
  ),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
