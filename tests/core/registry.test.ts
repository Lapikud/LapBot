import { describe, expect, it } from 'vitest';
import type { Feature } from '~/core/feature';
import { buildRegistry, customId, parseCustomId } from '~/core/registry';

const noop = async () => undefined;
const noopJob = async () => null;
const command = (name: string) => ({
  data: { name, description: name },
  execute: noop,
});

describe('buildRegistry', () => {
  it('collects declarations from every feature', () => {
    const registry = buildRegistry([
      {
        name: 'a',
        commands: [command('alpha')],
        components: [{ prefix: 'a:click', execute: noop }],
      },
      { name: 'b', permissions: [{ id: 'b:do', description: '' }] },
    ]);

    expect([...registry.commands.keys()]).toEqual(['alpha']);
    expect([...registry.components.keys()]).toEqual(['a:click']);
    expect([...registry.permissions.keys()]).toEqual(['b:do']);
  });

  it.each<[string, Feature[]]>([
    ['feature', [{ name: 'a' }, { name: 'a' }]],
    [
      'command',
      [
        { name: 'a', commands: [command('x')] },
        { name: 'b', commands: [command('x')] },
      ],
    ],
    [
      'component prefix',
      [
        { name: 'a', components: [{ prefix: 'x:y', execute: noop }] },
        { name: 'b', components: [{ prefix: 'x:y', execute: noop }] },
      ],
    ],
    [
      'job type',
      [
        { name: 'a', jobs: [{ type: 'j', maxAttempts: 1, run: noopJob }] },
        { name: 'b', jobs: [{ type: 'j', maxAttempts: 1, run: noopJob }] },
      ],
    ],
    [
      'permission',
      [
        { name: 'a', permissions: [{ id: 'p:x', description: '' }] },
        { name: 'b', permissions: [{ id: 'p:x', description: '' }] },
      ],
    ],
  ])('rejects a duplicate %s', (what, features) => {
    expect(() => buildRegistry(features)).toThrow(`Duplicate ${what}`);
  });

  it('rejects malformed component prefixes', () => {
    expect(() =>
      buildRegistry([
        { name: 'a', components: [{ prefix: 'a:b:c', execute: noop }] },
      ]),
    ).toThrow('Invalid component prefix');
  });
});

describe('custom IDs', () => {
  it('round-trips prefix and arguments', () => {
    expect(parseCustomId(customId('polls:vote', 12, 'x'))).toEqual({
      prefix: 'polls:vote',
      args: ['12', 'x'],
    });
    expect(parseCustomId('garbage')).toBeUndefined();
  });

  it('enforces the Discord length limit', () => {
    expect(() => customId('a:b', 'x'.repeat(100))).toThrow('100 characters');
  });
});
