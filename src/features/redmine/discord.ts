import {
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';
import type { RedmineService } from './service';
import { channelMention } from '~/core/message';
import { toActor } from '~/integrations/discord/actor';
import { bySubcommand, deferred } from '~/integrations/discord/define';
import type {
  CommandInteraction,
  Feature,
} from '~/integrations/discord/module';
import { respond } from '~/integrations/discord/router';

const data = new SlashCommandBuilder()
  .setName('redmine')
  .setDescription('Redmine project updates')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('subscribe')
      .setDescription('Post project updates in a channel')
      .addStringOption((o) =>
        o
          .setName('project')
          .setDescription('Project identifier')
          .setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel (default: here)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('unsubscribe')
      .setDescription('Stop project updates in a channel')
      .addStringOption((o) =>
        o
          .setName('project')
          .setDescription('Project identifier')
          .setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel (default: here)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  );

type Handler = (interaction: CommandInteraction) => Promise<void>;

export function redmineCommands(redmine: RedmineService): Feature {
  const actorOf = (interaction: CommandInteraction) =>
    toActor(interaction.member);
  const channelOf = (interaction: CommandInteraction) =>
    interaction.options.getChannel('channel')?.id ?? interaction.channelId;

  const handlers: Record<string, Handler> = {
    subscribe: async (interaction) => {
      const channelId = channelOf(interaction);
      const { project, added } = await redmine.subscribe(
        actorOf(interaction),
        channelId,
        interaction.options.getString('project', true),
      );

      await respond(
        interaction,
        added
          ? `${channelMention(channelId)} now gets updates for ${project.name}. Everyone who can read the channel will see them.`
          : 'That channel is already subscribed.',
      );
    },
    unsubscribe: async (interaction) => {
      const channelId = channelOf(interaction);
      const { project, removed } = await redmine.unsubscribe(
        actorOf(interaction),
        channelId,
        interaction.options.getString('project', true),
      );

      await respond(
        interaction,
        removed
          ? `Unsubscribed ${channelMention(channelId)} from ${project.name}.`
          : 'No such subscription.',
      );
    },
  };

  return {
    name: 'redmine',
    permissions: [
      {
        id: 'redmine:subscription:manage',
        description: 'Subscribe channels to Redmine projects',
      },
    ],
    commands: [
      {
        data: data.toJSON(),
        execute: bySubcommand(
          Object.fromEntries(
            Object.entries(handlers).map(([path, handler]) => [
              path,
              deferred(handler),
            ]),
          ),
        ),
      },
    ],
    start: () => redmine.start(),
  };
}
