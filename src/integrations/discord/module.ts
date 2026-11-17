import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from 'discord.js';
import type { Logger } from '~/foundation/logger';
import type { Authorizer } from '~/foundation/authorization';
import type { Permission, PermissionDefinition } from '~/foundation/permission';

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

export type MessageCommandInteraction =
  MessageContextMenuCommandInteraction<'cached'>;

export type MessageCommand = {
  data: RESTPostAPIContextMenuApplicationCommandsJSONBody;
  execute: (
    interaction: MessageCommandInteraction,
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
  messageCommands?: readonly MessageCommand[];
  components?: readonly ComponentHandler[];
  events?: readonly EventListener[];
  start?: () => Promise<void>;
};
