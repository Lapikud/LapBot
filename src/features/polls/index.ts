import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  userMention,
  type BaseMessageOptions,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { z } from 'zod';
import { respond } from '../../core/discord/router.js';
import { bySubcommand, defineJob } from '../../core/define.js';
import { isUnknownObject } from '../../core/discord/errors.js';
import type {
  AppContext,
  CommandInteraction,
  ComponentHandler,
  Feature,
} from '../../core/feature.js';
import { getGuildTimezone } from '../../core/guild-settings.js';
import { customId } from '../../core/registry.js';
import { UserError } from '../../shared/errors.js';
import { discordTime, parseFutureWhen } from '../../shared/time.js';
import type { Poll } from './schema.js';
import {
  castVote,
  finishPoll,
  getPoll,
  getResults,
  getVoterChoices,
  getVoters,
  insertPoll,
  isOpen,
  listOpenPolls,
  requirePoll,
  setPollMessage,
  type NewPoll,
  type PollResults,
  type PollWithOptions,
} from './service.js';

export type { PollResults, PollWithOptions } from './service.js';
export { getResults, latestPollBySource } from './service.js';

const closeKey = (id: number) => `poll:${id}:close`;

function bar(votes: number, total: number): string {
  const filled = total === 0 ? 0 : Math.round((votes / total) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function describeOutcome(results: PollResults, leader: string): string {
  const label = results.tie ? 'Tie' : leader;
  return `**${label}:** ${results.winners.map((w) => w.label).join(', ')}`;
}

export function renderPoll(
  poll: PollWithOptions,
  results: PollResults,
): BaseMessageOptions {
  const open = isOpen(poll);
  const showCounts = poll.showResults === 'live' || !open;
  const lines = results.options.map((option) =>
    showCounts
      ? `**${option.label}**\n${bar(option.votes, results.voters)} ${option.votes}`
      : `• ${option.label}`,
  );
  let status = poll.status === 'cancelled' ? 'Cancelled' : 'Closed';
  if (open) {
    status =
      poll.closesAt === null
        ? 'Open'
        : `Closes ${discordTime(poll.closesAt, 'R')}`;
  }
  const outcome =
    !open && results.winners.length > 0
      ? `\n\n${describeOutcome(results, 'Winner')}`
      : '';
  const embed = new EmbedBuilder()
    .setTitle(poll.question)
    .setDescription(`${lines.join('\n')}${outcome}`)
    .setFooter({
      text: [
        `Poll #${poll.id}`,
        poll.multiple ? 'multiple choice' : 'single choice',
        poll.anonymous ? 'anonymous' : 'votes visible to organizers',
        `${results.voters} voter${results.voters === 1 ? '' : 's'}`,
        status,
      ].join(' · '),
    });
  if (!open) {
    return { embeds: [embed], components: [] };
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId('polls:vote', poll.id))
    .setPlaceholder(poll.multiple ? 'Choose one or more' : 'Choose one')
    .setMinValues(1)
    .setMaxValues(poll.multiple ? poll.options.length : 1)
    .addOptions(
      poll.options.map((option) => ({
        label: option.label,
        value: String(option.id),
      })),
    );
  const clear = new ButtonBuilder()
    .setCustomId(customId('polls:clear', poll.id))
    .setLabel('Clear my vote')
    .setStyle(ButtonStyle.Secondary);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(clear),
    ],
  };
}

async function refreshMessage(ctx: AppContext, poll: Poll): Promise<void> {
  const full = await getPoll(ctx.db, poll.id);
  if (full?.messageId === null || full?.messageId === undefined) {
    return;
  }
  try {
    const channel = await ctx.client.channels.fetch(full.channelId);
    if (channel?.isTextBased() === true) {
      await channel.messages.edit(
        full.messageId,
        renderPoll(full, await getResults(ctx.db, full)),
      );
    }
  } catch (error) {
    if (!isUnknownObject(error)) {
      throw error;
    }
    ctx.log.warn({ pollId: poll.id }, 'Poll message or channel was deleted');
  }
}

export const closeJob = defineJob({
  type: 'polls:close',
  payload: z.object({ pollId: z.number().int() }),
  // Polls are closed even when the job runs late; only the message is updated.
  handle: async ({ pollId }, _info, ctx) => {
    const closed = await finishPoll(ctx.db, pollId, 'closed');
    if (closed) {
      await refreshMessage(ctx, closed);
    }
  },
});

/** Public API: publishes a poll and schedules its closing. */
export async function createPoll(
  ctx: AppContext,
  input: NewPoll,
): Promise<PollWithOptions> {
  const channel = await ctx.client.channels
    .fetch(input.channelId)
    .catch(() => null);
  if (channel?.isSendable() !== true) {
    throw new UserError('I cannot post in that channel.');
  }
  const poll = await insertPoll(ctx.db, input);
  const message = await channel.send(
    renderPoll(poll, await getResults(ctx.db, poll)),
  );
  await setPollMessage(ctx.db, poll.id, message.id);
  if (poll.closesAt !== null) {
    await ctx.scheduler.schedule(
      closeJob,
      { pollId: poll.id },
      { runAt: poll.closesAt, key: closeKey(poll.id) },
    );
  }
  return { ...poll, messageId: message.id };
}

/** Public API: closes a poll now. Returns false if it was not open. */
export async function closePoll(
  ctx: AppContext,
  pollId: number,
): Promise<boolean> {
  const closed = await finishPoll(ctx.db, pollId, 'closed');
  if (!closed) {
    return false;
  }
  await ctx.scheduler.cancel(closeKey(pollId));
  await refreshMessage(ctx, closed);
  return true;
}

async function vote(
  interaction: Parameters<ComponentHandler['execute']>[0],
  pollId: number,
  optionIds: number[],
  ctx: AppContext,
): Promise<void> {
  await castVote(ctx.db, pollId, interaction.user.id, optionIds);
  const poll = await getPoll(ctx.db, pollId);
  if (!poll || interaction.isModalSubmit()) {
    return;
  }
  const results = await getResults(ctx.db, poll);
  await interaction.update(renderPoll(poll, results));
  const chosen = poll.options
    .filter((o) => optionIds.includes(o.id))
    .map((o) => o.label);
  await interaction.followUp({
    content:
      chosen.length === 0
        ? 'Your vote is cleared.'
        : `Your vote: **${chosen.join(', ')}**`,
    flags: MessageFlags.Ephemeral,
  });
}

function parseId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new UserError('This poll control is invalid.');
  }
  return id;
}

const voteHandler: ComponentHandler = {
  prefix: 'polls:vote',
  execute: async (interaction, [id], ctx) => {
    if (!interaction.isStringSelectMenu()) {
      return;
    }
    await vote(interaction, parseId(id), interaction.values.map(Number), ctx);
  },
};

const clearHandler: ComponentHandler = {
  prefix: 'polls:clear',
  execute: async (interaction, [id], ctx) => {
    const pollId = parseId(id);
    const current = await getVoterChoices(ctx.db, pollId, interaction.user.id);
    if (current.length === 0) {
      throw new UserError('You have not voted.');
    }
    await vote(interaction, pollId, [], ctx);
  },
};

async function requireManageable(
  interaction: CommandInteraction,
  ctx: AppContext,
): Promise<PollWithOptions> {
  const poll = await requirePoll(
    ctx.db,
    interaction.guildId,
    interaction.options.getInteger('id', true),
  );
  if (poll.creatorId !== interaction.user.id) {
    await ctx.authz.require(interaction.member, 'poll:manage');
  }
  return poll;
}

const idOption = (o: SlashCommandIntegerOption) =>
  o
    .setName('id')
    .setDescription('Poll')
    .setRequired(true)
    .setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Polls')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Start a poll')
      .addStringOption((o) =>
        o
          .setName('question')
          .setDescription('Question')
          .setRequired(true)
          .setMaxLength(256),
      )
      .addStringOption((o) =>
        o
          .setName('options')
          .setDescription('Options separated by | e.g. "Pizza | Sushi | Tacos"')
          .setRequired(true),
      )
      .addBooleanOption((o) =>
        o.setName('multiple').setDescription('Allow several choices'),
      )
      .addBooleanOption((o) =>
        o.setName('anonymous').setDescription('Hide who voted for what'),
      )
      .addStringOption((o) =>
        o
          .setName('results')
          .setDescription('When results are visible')
          .addChoices(
            { name: 'live', value: 'live' },
            { name: 'after closing', value: 'closed' },
          ),
      )
      .addStringOption((o) =>
        o.setName('closes').setDescription('e.g. 1d, 2h, 2026-11-20 18:00'),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post (default: here)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('Open polls'))
  .addSubcommand((sub) =>
    sub
      .setName('results')
      .setDescription('Show results')
      .addIntegerOption(idOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('close')
      .setDescription('Close a poll now')
      .addIntegerOption(idOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel a poll')
      .addIntegerOption(idOption),
  );

async function showResults(
  interaction: CommandInteraction,
  ctx: AppContext,
): Promise<void> {
  const poll = await requirePoll(
    ctx.db,
    interaction.guildId,
    interaction.options.getInteger('id', true),
  );
  const manager =
    poll.creatorId === interaction.user.id ||
    (await ctx.authz.can(interaction.member, 'poll:manage'));
  if (poll.showResults === 'closed' && isOpen(poll) && !manager) {
    throw new UserError('Results are shown when the poll closes.');
  }
  const results = await getResults(ctx.db, poll);
  const voters =
    !poll.anonymous && manager ? await getVoters(ctx.db, poll.id) : undefined;
  const lines = results.options.map((option) => {
    const names = voters?.get(option.id)?.map((id) => userMention(id)) ?? [];
    return [`**${option.label}** — ${option.votes}`, ...names].join(' ');
  });
  const winner =
    results.winners.length === 0
      ? 'No votes yet.'
      : describeOutcome(results, 'Leading');
  await respond(
    interaction,
    [`**${poll.question}**`, ...lines, winner].join('\n').slice(0, 2000),
  );
}

export const pollsFeature: Feature = {
  name: 'polls',
  permissions: [
    { id: 'poll:create', description: 'Start polls' },
    { id: 'poll:manage', description: 'Close and cancel any poll, see voters' },
  ],
  jobs: [closeJob],
  components: [voteHandler, clearHandler],
  commands: [
    {
      data: data.toJSON(),
      permissions: { create: 'poll:create' },
      execute: bySubcommand({
        create: async (interaction, ctx) => {
          const closes = interaction.options.getString('closes');
          const zone = await getGuildTimezone(
            ctx.db,
            interaction.guildId,
            ctx.config.DEFAULT_TIMEZONE,
          );
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const poll = await createPoll(ctx, {
            guildId: interaction.guildId,
            channelId:
              interaction.options.getChannel('channel')?.id ??
              interaction.channelId,
            creatorId: interaction.user.id,
            question: interaction.options.getString('question', true),
            options: interaction.options
              .getString('options', true)
              .split('|')
              .map((label) => ({ label })),
            multiple: interaction.options.getBoolean('multiple') ?? false,
            anonymous: interaction.options.getBoolean('anonymous') ?? false,
            showResults:
              interaction.options.getString('results') === 'closed'
                ? 'closed'
                : 'live',
            closesAt: closes === null ? null : parseFutureWhen(closes, zone),
          });
          await interaction.editReply(
            `Poll #${poll.id} is up in <#${poll.channelId}>.`,
          );
        },
        list: async (interaction, ctx) => {
          const open = await listOpenPolls(ctx.db, interaction.guildId);
          await respond(
            interaction,
            open.length === 0
              ? 'No open polls.'
              : open
                  .map((p) => `#${p.id} ${p.question} — <#${p.channelId}>`)
                  .join('\n'),
          );
        },
        results: showResults,
        close: async (interaction, ctx) => {
          const poll = await requireManageable(interaction, ctx);
          if (!(await closePoll(ctx, poll.id))) {
            throw new UserError('That poll is not open.');
          }
          await respond(interaction, `Poll #${poll.id} is closed.`);
        },
        cancel: async (interaction, ctx) => {
          const poll = await requireManageable(interaction, ctx);
          const cancelled = await finishPoll(ctx.db, poll.id, 'cancelled');
          if (!cancelled) {
            throw new UserError('That poll is not open.');
          }
          await ctx.scheduler.cancel(closeKey(poll.id));
          await refreshMessage(ctx, cancelled);
          await respond(interaction, `Poll #${poll.id} is cancelled.`);
        },
      }),
      autocomplete: async (interaction, ctx) => {
        const open = await listOpenPolls(ctx.db, interaction.guildId);
        await interaction.respond(
          open.map((p) => ({
            name: `#${p.id} ${p.question}`.slice(0, 100),
            value: p.id,
          })),
        );
      },
    },
  ],
};
