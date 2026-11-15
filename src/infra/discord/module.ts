import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Logger, Authorizer } from '~/core/ports';
import type { Permission, PermissionDefinition } from '~/domain';

export type { Permission, PermissionDefinition } from '~/domain';

export type AppContext = {
  log: Logger;
  authz: Authorizer;
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

export type Feature = {
  name: string;
  permissions?: readonly PermissionDefinition[];
  commands?: readonly SlashCommand[];
  components?: readonly ComponentHandler[];
  events?: readonly EventListener[];
  start?: () => Promise<void>;
};
