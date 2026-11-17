import { isZone } from '~/core/helpers/time';
import { z } from 'zod';

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional(),
  );

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

const serviceAccount = z
  .string()
  .transform((value, ctx): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be the JSON key file' });

      return z.NEVER;
    }
  })
  .pipe(z.object({ client_email: z.email(), private_key: z.string().min(1) }));

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: optional(snowflake),
  DISCORD_GUILD_ID: optional(snowflake),

  DATABASE_URL: z.url(),

  LOG_DATABASE_PATH: z.string().min(1).default('logs/lapbot.sqlite'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DEFAULT_TIMEZONE: z
    .string()
    .default('Europe/Tallinn')
    .refine((zone) => isZone(zone), 'must be an IANA timezone'),

  JUHATUS_ROLE_ID: optional(snowflake),

  ROLE_SELECTION_CHANNEL_ID: optional(snowflake),
  TARKVARA_ROLE_ID: optional(snowflake),
  HELPDESK_ROLE_ID: optional(snowflake),
  KULTUUR_ROLE_ID: optional(snowflake),

  TMDB_ACCESS_TOKEN: optional(z.string().min(1)),

  GOOGLE_CALENDAR_ID: optional(z.string().min(1)),
  GOOGLE_SERVICE_ACCOUNT_KEY: optional(serviceAccount),

  WEB_PORT: optional(z.coerce.number().int().min(1).max(65_535)),
  WEB_HOST: z.string().default('127.0.0.1'),
  WEB_URL: optional(z.url()),
  DISCORD_CLIENT_SECRET: optional(z.string().min(1)),
  SESSION_SECRET: optional(
    z.string().min(32, 'must be at least 32 characters'),
  ),
});

export type Config = z.infer<typeof envSchema>;

const checkedSchema = envSchema
  .refine(
    (env) => env.WEB_PORT === undefined || env.DISCORD_GUILD_ID !== undefined,
    {
      message: 'DISCORD_GUILD_ID is required when WEB_PORT is set',
      path: ['DISCORD_GUILD_ID'],
    },
  )
  .refine(
    (env) =>
      (env.GOOGLE_CALENDAR_ID === undefined) ===
      (env.GOOGLE_SERVICE_ACCOUNT_KEY === undefined),
    {
      message:
        'GOOGLE_CALENDAR_ID and GOOGLE_SERVICE_ACCOUNT_KEY must be set together',
      path: ['GOOGLE_CALENDAR_ID'],
    },
  );

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = checkedSchema.safeParse(env);

  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
