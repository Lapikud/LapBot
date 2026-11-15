import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  GuildMember,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Db } from '../db/client.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';

/** Action identifiers such as `event:create`; features declare their own. */
export type Permission = `${string}:${string}`;

export type PermissionDefinition = {
  id: Permission;
  description: string;
};

export type Authorizer = {
  can: (member: GuildMember, permission: Permission) => Promise<boolean>;
  /** Throws a UserError when the member lacks the permission. */
  require: (member: GuildMember, permission: Permission) => Promise<void>;
};

export type ScheduleOptions = {
  runAt: Date;
  /** Scheduling again with the same key replaces the pending job. */
  key?: string;
  maxAttempts?: number;
};

export type Scheduler = {
  schedule: <P>(
    job: Job<P>,
    payload: P,
    options: ScheduleOptions,
  ) => Promise<void>;
  cancel: (key: string) => Promise<void>;
};

export type AppContext = {
  client: Client<true>;
  db: Db;
  log: Logger;
  config: Config;
  authz: Authorizer;
  scheduler: Scheduler;
};

export type CommandInteraction = ChatInputCommandInteraction<'cached'>;

export type SlashCommand = {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /**
   * Permission required per subcommand path ("create", "panel create"), or
   * `'*'` for the whole command. Unlisted subcommands are open to members.
   */
  permissions?: Partial<Record<string, Permission>>;
  execute: (interaction: CommandInteraction, ctx: AppContext) => Promise<void>;
  autocomplete?: (
    interaction: AutocompleteInteraction<'cached'>,
    ctx: AppContext,
  ) => Promise<void>;
};

export type ComponentInteraction =
  | ButtonInteraction<'cached'>
  | AnySelectMenuInteraction<'cached'>
  | ModalSubmitInteraction<'cached'>;

/**
 * Handles buttons, select menus and modals whose custom ID starts with
 * `prefix` followed by `:`. Remaining `:`-separated segments become `args`.
 */
export type ComponentHandler = {
  prefix: string;
  permission?: Permission;
  execute: (
    interaction: ComponentInteraction,
    args: readonly string[],
    ctx: AppContext,
  ) => Promise<void>;
};

export type EventListener = {
  event: keyof ClientEvents;
  attach: (client: Client, ctx: AppContext) => void;
};

export type JobInfo = {
  id: number;
  /** When the job was due; handlers decide what lateness means for them. */
  runAt: Date;
  attempt: number;
};

/** Returning a date makes the job recur at that time. */
export type JobOutcome = null | { rescheduleAt: Date };

export type Job<P> = {
  type: string;
  maxAttempts: number;
  run: (raw: unknown, info: JobInfo, ctx: AppContext) => Promise<JobOutcome>;
  /** Carries the payload type for `Scheduler.schedule`; never set. */
  payloadType?: P;
};

export type Feature = {
  name: string;
  permissions?: readonly PermissionDefinition[];
  commands?: readonly SlashCommand[];
  components?: readonly ComponentHandler[];
  events?: readonly EventListener[];
  jobs?: ReadonlyArray<Job<unknown>>;
  /** Runs once after the client is ready and migrations have applied. */
  start?: (ctx: AppContext) => Promise<void>;
};
