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
import type { Logger } from '~/core/ports/logger';
import type { Authorizer } from '~/core/ports/authorization';
import type { Permission, PermissionDefinition } from '~/core/permission';

export interface AppContext {
  log: Logger;
  authz: Authorizer;
}

export type CommandInteraction = ChatInputCommandInteraction<'cached'>;

export interface SlashCommand {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  permissions?: Partial<Record<string, Permission>>;
  execute: (interaction: CommandInteraction, ctx: AppContext) => Promise<void>;
  autocomplete?: (
    interaction: AutocompleteInteraction<'cached'>,
    ctx: AppContext,
  ) => Promise<void>;
}

export type MessageCommandInteraction =
  MessageContextMenuCommandInteraction<'cached'>;

export interface MessageCommand {
  data: RESTPostAPIContextMenuApplicationCommandsJSONBody;
  execute: (
    interaction: MessageCommandInteraction,
    ctx: AppContext,
  ) => Promise<void>;
}

export type ComponentInteraction =
  | ButtonInteraction<'cached'>
  | AnySelectMenuInteraction<'cached'>
  | ModalSubmitInteraction<'cached'>;

export type Repliable =
  CommandInteraction | ComponentInteraction | MessageCommandInteraction;

export interface ComponentHandler {
  prefix: string;
  permission?: Permission;
  execute: (
    interaction: ComponentInteraction,
    args: readonly string[],
    ctx: AppContext,
  ) => Promise<void>;
}

export interface EventListener {
  event: keyof ClientEvents;
  attach: (client: Client, ctx: AppContext) => void;
}

export interface Feature {
  name: string;
  permissions?: readonly PermissionDefinition[];
  commands?: readonly SlashCommand[];
  messageCommands?: readonly MessageCommand[];
  components?: readonly ComponentHandler[];
  events?: readonly EventListener[];
  start?: () => Promise<void>;
}
