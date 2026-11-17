import { expect, it, vi } from 'vitest';
import { eventCommands } from '~/presentation/discord/commands/events';
import { pollCommands } from '~/presentation/discord/commands/polls';
import type { EventService } from '~/features/events/service';
import type { PollService } from '~/features/polls/service';
import type {
  AppContext,
  CommandInteraction,
  SlashCommand,
} from '~/presentation/discord/module';
import { allowAll, fakeDirectory, silentLog } from '../../fakes';

it('filters private events and polls from Discord lists and autocomplete', async () => {
  const directory = fakeDirectory();

  directory.canView.mockImplementation(async (_actor, id) => id === 'public');
  const records = ['public', 'private'].map((channelId, id) => ({
    id,
    channelId,
    title: channelId,
    question: channelId,
    startsAt: new Date(),
  }));
  const features = [
    eventCommands(
      { upcoming: async () => records } as unknown as EventService,
      directory,
    ),
    pollCommands(
      { open: async () => records } as unknown as PollService,
      directory,
    ),
  ];
  const context: AppContext = { authz: allowAll, log: silentLog };

  for (const feature of features) {
    const command = feature.commands?.[0];

    if (!command?.autocomplete) {
      throw new Error('Missing command or autocomplete');
    }

    const reply = vi.fn<(message: { content: string }) => Promise<void>>(
      async () => undefined,
    );
    const respond = vi.fn();
    const interaction = {
      guildId: 'g',
      member: {
        id: 'u',
        guild: { id: 'g', ownerId: 'owner' },
        roles: { cache: new Map(), highest: { position: 1 } },
        permissions: { has: () => false },
      },
      options: { getSubcommandGroup: () => null, getSubcommand: () => 'list' },
      reply,
      respond,
    };

    await command.execute(
      interaction as unknown as CommandInteraction,
      context,
    );
    expect(reply.mock.calls.at(0)?.[0].content).toContain('public');
    expect(reply.mock.calls.at(0)?.[0].content).not.toContain('private');
    await command.autocomplete(
      interaction as unknown as Parameters<
        NonNullable<SlashCommand['autocomplete']>
      >[0],
      context,
    );
    expect(respond).toHaveBeenCalledWith([{ name: '#0 public', value: 0 }]);
  }
});
