import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { UserError } from '~/core/errors';
import type { AppContext, Feature } from '~/presentation/discord/contracts';
import { buildRegistry } from '~/presentation/discord/registry';
import { createInteractionHandler } from '~/presentation/discord/interactions/router';

function context(allowed: boolean) {
  const require = vi.fn(async () => {
    if (!allowed) {
      throw new UserError('denied');
    }
  });
  const ctx = {
    log: pino({ level: 'silent' }),
    authz: { require, can: vi.fn() },
  } as unknown as AppContext;

  return { ctx, require };
}

function commandInteraction(commandName: string, subcommand: string | null) {
  return {
    inCachedGuild: () => true,
    isAutocomplete: () => false,
    isMessageContextMenuCommand: () => false,
    isChatInputCommand: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    commandName,
    guildId: 'g',
    user: { id: 'u' },
    member: {
      id: 'u',
      guild: { id: 'g', ownerId: 'o' },
      permissions: { has: () => false },
      roles: { cache: new Map(), highest: { position: 1 } },
    },
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => subcommand,
    },
    deferred: false,
    replied: false,
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

function componentInteraction(customId: string) {
  return {
    ...commandInteraction('', null),
    isChatInputCommand: () => false,
    isMessageComponent: () => true,
    customId,
  };
}

const execute = vi.fn(async () => undefined);
const features: Feature[] = [
  {
    name: 'demo',
    commands: [
      {
        data: { name: 'demo', description: 'demo' },
        permissions: { manage: 'demo:manage' },
        execute,
      },
      {
        data: { name: 'boom', description: 'boom' },
        execute: async () => {
          throw new Error('kaboom');
        },
      },
    ],
    components: [{ prefix: 'demo:press', permission: 'demo:manage', execute }],
  },
];

describe('interaction router', () => {
  const registry = buildRegistry(features);

  it('routes public subcommands without a permission check', async () => {
    const { ctx, require } = context(false);

    execute.mockClear();
    await createInteractionHandler(
      registry,
      ctx,
    )(commandInteraction('demo', 'view') as never);
    expect(require).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('enforces declared permissions before executing', async () => {
    const { ctx, require } = context(false);

    execute.mockClear();
    const interaction = commandInteraction('demo', 'manage');

    await createInteractionHandler(registry, ctx)(interaction as never);
    expect(require).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u', guildId: 'g' }),
      'demo:manage',
    );
    expect(execute).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'denied' }),
    );
  });

  it('rechecks permissions on persistent components and passes arguments', async () => {
    const allowed = context(true);

    execute.mockClear();
    const interaction = componentInteraction('demo:press:42:x');

    await createInteractionHandler(registry, allowed.ctx)(interaction as never);
    expect(allowed.require).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u' }),
      'demo:manage',
    );
    expect(execute).toHaveBeenCalledWith(interaction, ['42', 'x'], allowed.ctx);
  });

  it('answers unknown components instead of failing silently', async () => {
    const { ctx } = context(true);
    const interaction = componentInteraction('gone:button:1');

    await createInteractionHandler(registry, ctx)(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'This control is no longer active.' }),
    );
  });

  it('hides unexpected errors behind a reference', async () => {
    const { ctx } = context(true);
    const interaction = commandInteraction('boom', null);

    await createInteractionHandler(registry, ctx)(interaction as never);
    const [[reply]] = interaction.reply.mock.calls as unknown as [
      [{ content: string }],
    ];

    expect(reply.content).toMatch(
      /^Something went wrong\. Reference: `\w{8}`$/,
    );
  });

  it('completes a deferred reply, or follows up after a real one', async () => {
    const { ctx } = context(true);
    const handle = createInteractionHandler(registry, ctx);
    const pending = {
      ...commandInteraction('boom', null),
      deferred: true,
      editReply: vi.fn(async () => undefined),
    };

    await handle(pending as never);
    expect(pending.editReply).toHaveBeenCalledOnce();
    expect(pending.reply).not.toHaveBeenCalled();

    const answered = { ...commandInteraction('boom', null), replied: true };

    await handle(answered as never);
    expect(answered.followUp).toHaveBeenCalledOnce();
  });
});
