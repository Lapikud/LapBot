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
import type { Db } from '~/infra/db';
import type { Config } from '~/config';
import type { Logger } from '~/infra/logging';

export type Permission = `${string}:${string}`;

export type PermissionDefinition = {
  id: Permission;
  description: string;
};

export type Authorizer = {
  can: (member: GuildMember, permission: Permission) => Promise<boolean>;
  require: (member: GuildMember, permission: Permission) => Promise<void>;
};

export type ScheduleOptions = {
  runAt: Date;
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
  runAt: Date;
  attempt: number;
};

export type JobOutcome = null | { rescheduleAt: Date };

export type Job<P> = {
  type: string;
  maxAttempts: number;
  run: (raw: unknown, info: JobInfo, ctx: AppContext) => Promise<JobOutcome>;
  payloadType?: P;
};

export type Feature = {
  name: string;
  permissions?: readonly PermissionDefinition[];
  commands?: readonly SlashCommand[];
  components?: readonly ComponentHandler[];
  events?: readonly EventListener[];
  jobs?: ReadonlyArray<Job<unknown>>;
  start?: (ctx: AppContext) => Promise<void>;
};
