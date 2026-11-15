import type {
  ComponentHandler,
  Feature,
  Job,
  Permission,
  PermissionDefinition,
  SlashCommand,
} from './feature';

export type Registry = {
  features: readonly Feature[];
  commands: ReadonlyMap<string, SlashCommand>;
  components: ReadonlyMap<string, ComponentHandler>;
  jobs: ReadonlyMap<string, Job<unknown>>;
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
  const components = new Map<string, ComponentHandler>();
  const jobs = new Map<string, Job<unknown>>();
  const permissions = new Map<Permission, PermissionDefinition>();

  for (const feature of features) {
    addUnique(names, feature.name, feature, 'feature');
    for (const command of feature.commands ?? []) {
      addUnique(commands, command.data.name, command, 'command');
    }

    for (const component of feature.components ?? []) {
      if (!componentPrefix.test(component.prefix)) {
        throw new Error(`Invalid component prefix "${component.prefix}"`);
      }

      addUnique(components, component.prefix, component, 'component prefix');
    }

    for (const job of feature.jobs ?? []) {
      addUnique(jobs, job.type, job, 'job type');
    }

    for (const permission of feature.permissions ?? []) {
      if (permissions.has(permission.id)) {
        throw new Error(`Duplicate permission "${permission.id}"`);
      }

      permissions.set(permission.id, permission);
    }
  }

  return { features, commands, components, jobs, permissions };
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

export function customId(
  prefix: string,
  ...args: Array<string | number>
): string {
  const id = [prefix, ...args].join(':');

  if (id.length > 100) {
    throw new Error(`Custom ID exceeds 100 characters: ${id}`);
  }

  return id;
}
