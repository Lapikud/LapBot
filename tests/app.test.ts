import type {
  APIApplicationCommandOption,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { compose, createRegistry } from '~/app';
import type { Config } from '~/config';

const config = {
  DEFAULT_TIMEZONE: 'Europe/Tallinn',
  REDMINE_BASE_URL: 'https://redmine.example',
  REDMINE_API_KEY: 'key',
} as Config;

function problems(
  path: string,
  options: readonly APIApplicationCommandOption[] = [],
): string[] {
  const found: string[] = [];

  if (options.length > 25) {
    found.push(`${path}: more than 25 options`);
  }

  let optionalSeen = false;

  for (const option of options) {
    const name = `${path} ${option.name}`;

    if (!/^[\p{Ll}\p{N}_-]{1,32}$/u.test(option.name)) {
      found.push(`${name}: invalid name`);
    }

    if (option.description.length === 0 || option.description.length > 100) {
      found.push(`${name}: description must be 1-100 characters`);
    }

    if ('options' in option) {
      found.push(...problems(name, option.options));
      continue;
    }

    const required = 'required' in option && option.required;

    if (required && optionalSeen) {
      found.push(`${name}: required option after an optional one`);
    }

    optionalSeen ||= !required;
  }

  return found;
}

type Counted = {
  name: string;
  description?: string;
  options?: readonly Counted[];
  choices?: ReadonlyArray<{ name: string; value: string | number }>;
};

function characters(node: Counted): number {
  return (
    node.name.length +
    (node.description?.length ?? 0) +
    (node.choices ?? []).reduce(
      (sum, choice) => sum + choice.name.length + String(choice.value).length,
      0,
    ) +
    (node.options ?? []).reduce((sum, option) => sum + characters(option), 0)
  );
}

describe('composition root', () => {
  const registry = createRegistry(config, pino({ level: 'silent' }));

  it('builds without duplicate handlers', () => {
    expect(registry.features.map((f) => f.name)).toContain('roles');
    expect(registry.commands.size).toBeGreaterThan(5);
    expect([...registry.messageCommands.keys()]).toContain(
      'Remind me tomorrow',
    );
  });

  it('disables Redmine commands even when Redmine is configured', () => {
    expect(registry.commands.has('redmine')).toBe(false);
  });

  it('declares commands Discord will accept', () => {
    const commands = [...registry.commands.values()].map(
      (c): RESTPostAPIChatInputApplicationCommandsJSONBody => c.data,
    );

    expect(commands.flatMap((c) => problems(`/${c.name}`, c.options))).toEqual(
      [],
    );
  });

  it('keeps every command under the 4000 character limit', () => {
    const sizes = [...registry.commands.values()].map((c) => ({
      name: c.data.name,
      size: characters(c.data as Counted),
    }));

    expect(sizes.filter(({ size }) => size > 4000)).toEqual([]);
  });

  it('names every job so pg-boss accepts it as a queue', () => {
    const { jobs } = compose(config, pino({ level: 'silent' }));

    expect(
      [...jobs.keys()].filter((type) => !/^[\w.\-/]+$/.test(type)),
    ).toEqual([]);
  });

  it('only requires permissions that some feature declares', () => {
    const declared = new Set(registry.permissions.keys());
    const used = [...registry.commands.values()].flatMap((c) =>
      Object.values(c.permissions ?? {}),
    );
    const usedByComponents = [...registry.components.values()].flatMap(
      (c) => c.permission ?? [],
    );

    expect(
      [...used, ...usedByComponents].filter(
        (p) => p !== undefined && !declared.has(p),
      ),
    ).toEqual([]);
  });
});
