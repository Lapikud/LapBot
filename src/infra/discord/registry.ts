import type {
  ComponentHandler,
  Feature,
  MessageCommand,
  Permission,
  PermissionDefinition,
  SlashCommand,
} from './module';

export type Registry = {
  features: readonly Feature[];
  commands: ReadonlyMap<string, SlashCommand>;
  messageCommands: ReadonlyMap<string, MessageCommand>;
  components: ReadonlyMap<string, ComponentHandler>;
  permissions: ReadonlyMap<Permission, PermissionDefinition>;
};

const componentPrefix = /^[a-z][a-z-]*:[a-z][a-z-]*$/;

function addUnique<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  what: string,
): void {
  if (map.has(key)) {
    throw new Error(`Duplicate ${what} "${key}"`);
  }

  map.set(key, value);
}

export function buildRegistry(features: readonly Feature[]): Registry {
  const names = new Map<string, Feature>();
  const commands = new Map<string, SlashCommand>();
  const messageCommands = new Map<string, MessageCommand>();
  const components = new Map<string, ComponentHandler>();
  const permissions = new Map<Permission, PermissionDefinition>();

  for (const feature of features) {
    addUnique(names, feature.name, feature, 'feature');
    for (const command of feature.commands ?? []) {
      addUnique(commands, command.data.name, command, 'command');
    }

    for (const command of feature.messageCommands ?? []) {
      addUnique(messageCommands, command.data.name, command, 'message command');
    }

    for (const component of feature.components ?? []) {
      if (!componentPrefix.test(component.prefix)) {
        throw new Error(`Invalid component prefix "${component.prefix}"`);
      }

      addUnique(components, component.prefix, component, 'component prefix');
    }

    for (const permission of feature.permissions ?? []) {
      if (permissions.has(permission.id)) {
        throw new Error(`Duplicate permission "${permission.id}"`);
      }

      permissions.set(permission.id, permission);
    }
  }

  return { features, commands, messageCommands, components, permissions };
}

export function parseCustomId(
  id: string,
): { prefix: string; args: string[] } | undefined {
  const [feature, action, ...args] = id.split(':');

  if (feature === undefined || action === undefined) {
    return undefined;
  }

  return { prefix: `${feature}:${action}`, args };
}
