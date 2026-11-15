import type {
  APIApplicationCommandOption,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '~/app';
import type { Config } from '~/core/config';

const config = { DEFAULT_TIMEZONE: 'Europe/Tallinn' } as Config;

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

describe('composition root', () => {
  const registry = createRegistry(config);

  it('builds without duplicate handlers', () => {
    expect(registry.features.map((f) => f.name)).toContain('roles');
    expect(registry.commands.size).toBeGreaterThan(5);
  });

  it('declares commands Discord will accept', () => {
    const commands = [...registry.commands.values()].map(
      (c): RESTPostAPIChatInputApplicationCommandsJSONBody => c.data,
    );

    expect(commands.flatMap((c) => problems(`/${c.name}`, c.options))).toEqual(
      [],
    );
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
