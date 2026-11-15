import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type BaseMessageOptions,
  type GuildMember,
  type MessageMentionOptions,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { z } from 'zod';
import { respond } from '../../core/discord/router.js';
import { bySubcommand, defineJob } from '../../core/define.js';
import { asJobError } from '../../core/discord/errors.js';
import type {
  AppContext,
  CommandInteraction,
  ComponentHandler,
  Feature,
} from '../../core/feature.js';
import { getGuildTimezone } from '../../core/guild-settings.js';
import { customId } from '../../core/registry.js';
import { PermanentError, UserError } from '../../shared/errors.js';
import { discordTime, parseFutureWhen } from '../../shared/time.js';
import type { Announcement } from './schema.js';
import {
  getAnnouncement,
  insertAnnouncement,
  listAnnouncements,
  requireAnnouncement,
  transition,
  updateContent,
} from './service.js';

const jobKey = (id: number) => `announcement:${id}`;
/** A scheduled announcement this late is stale and is not posted. */
const maxLatenessMs = 60 * 60 * 1000;
const maxContent = 4000;

function mentions(announcement: Announcement): {
  prefix: string;
  allowed: MessageMentionOptions;
} {
  const role = announcement.mentionRoleId;
  if (role === null) {
    return { prefix: '', allowed: { parse: [] } };
  }
  if (role === announcement.guildId) {
    return { prefix: '@everyone ', allowed: { parse: ['everyone'] } };
  }
  return { prefix: `<@&${role}> `, allowed: { roles: [role] } };
}

export function render(announcement: Announcement): BaseMessageOptions {
  const { prefix, allowed } = mentions(announcement);
  if (announcement.embed) {
    const embed = new EmbedBuilder()
      .setDescription(announcement.content)
      .setColor(0xff_ac_1c);
    if (announcement.title !== null) {
      embed.setTitle(announcement.title);
    }
    return {
      ...(prefix === '' ? {} : { content: prefix.trim() }),
      embeds: [embed],
      allowedMentions: allowed,
    };
  }
  const heading =
    announcement.title === null ? '' : `**${announcement.title}**\n`;
  const content = `${prefix}${heading}${announcement.content}`;
  if (content.length > 2000) {
    throw new UserError(
      'Plain announcements are limited to 2000 characters; use an embed.',
    );
  }
  return { content, allowedMentions: allowed };
}

/** A private rendering that shows, but never sends, the mention. */
function preview(announcement: Announcement, note: string) {
  const rendered = render(announcement);
  return {
    content: [note, rendered.content].filter(Boolean).join('\n\n'),
    embeds: rendered.embeds ?? [],
    allowedMentions: { parse: [] },
    flags: MessageFlags.Ephemeral,
  } as const;
}

/** Claims, posts and records an announcement. Posting happens at most once. */
async function publish(
  ctx: AppContext,
  id: number,
  from: Array<Announcement['status']>,
): Promise<Announcement> {
  const claimed = await transition(ctx.db, id, from, { status: 'publishing' });
  if (!claimed) {
    throw new UserError(
      `Announcement #${id} cannot be published in its current state.`,
    );
  }
  try {
    const channel = await ctx.client.channels.fetch(claimed.channelId);
    if (channel?.isSendable() !== true) {
      throw new PermanentError('Destination channel is not available');
    }
    const message = await channel.send(render(claimed));
    const published = await transition(ctx.db, id, ['publishing'], {
      status: 'published',
      publishedAt: new Date(),
      messageId: message.id,
      failure: null,
    });
    ctx.log.info(
      { announcementId: id, messageId: message.id },
      'Announcement published',
    );
    return published ?? claimed;
  } catch (error) {
    const jobError = asJobError(error);
    const permanent =
      jobError instanceof PermanentError || error instanceof UserError;
    const message = error instanceof Error ? error.message : String(error);
    // Transient failures return to their previous state so they can be retried.
    await transition(ctx.db, id, ['publishing'], {
      status: permanent ? 'failed' : (from[0] ?? 'draft'),
      failure: message,
    });
    throw jobError;
  }
}

const publishJob = defineJob({
  type: 'announcements:publish',
  payload: z.object({ announcementId: z.number().int() }),
  handle: async ({ announcementId }, _info, ctx) => {
    const announcement = await getAnnouncement(ctx.db, announcementId);
    if (announcement?.status !== 'scheduled') {
      return;
    }
    const due = announcement.scheduledAt ?? announcement.createdAt;
    if (Date.now() - due.getTime() > maxLatenessMs) {
      await transition(ctx.db, announcementId, ['scheduled'], {
        status: 'failed',
        failure: 'Skipped: the scheduled time passed while the bot was offline',
      });
      ctx.log.warn({ announcementId }, 'Skipped stale scheduled announcement');
      return;
    }
    // Retries come back here while still 'scheduled'; publish() restores that state.
    await publish(ctx, announcementId, ['scheduled']);
  },
});

function checkMention(member: GuildMember, roleId: string | null): void {
  if (roleId === null) {
    return;
  }
  const canPingAll = member.permissions.has(
    PermissionFlagsBits.MentionEveryone,
  );
  const role = member.guild.roles.cache.get(roleId);
  if (
    roleId === member.guild.id
      ? !canPingAll
      : role?.mentionable !== true && !canPingAll
  ) {
    throw new UserError('You may not mention that role.');
  }
}

function contentModal(
  id: string,
  title: string,
  current?: Announcement,
): ModalBuilder {
  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256);
  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(maxContent);
  if (current?.title !== null && current?.title !== undefined) {
    titleInput.setValue(current.title);
  }
  if (current) {
    contentInput.setValue(current.content);
  }
  return new ModalBuilder()
    .setCustomId(id)
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder().setLabel('Title').setTextInputComponent(titleInput),
      new LabelBuilder()
        .setLabel('Content')
        .setTextInputComponent(contentInput),
    );
}

async function requireEditable(
  interaction: CommandInteraction | Parameters<ComponentHandler['execute']>[0],
  ctx: AppContext,
  id: number,
): Promise<Announcement> {
  const announcement = await requireAnnouncement(
    ctx.db,
    interaction.guildId,
    id,
  );
  if (announcement.authorId !== interaction.user.id) {
    await ctx.authz.require(interaction.member, 'announcement:publish');
  }
  return announcement;
}

const createModal: ComponentHandler = {
  prefix: 'announcements:create',
  permission: 'announcement:create',
  execute: async (interaction, args, ctx) => {
    if (!interaction.isModalSubmit()) {
      return;
    }
    const [channelId = '', embed, role] = args;
    const mentionRoleId = role === undefined || role === '-' ? null : role;
    checkMention(interaction.member, mentionRoleId);
    const title = interaction.fields.getTextInputValue('title').trim();
    const announcement = await insertAnnouncement(ctx.db, {
      guildId: interaction.guildId,
      authorId: interaction.user.id,
      channelId,
      title: title === '' ? null : title,
      content: interaction.fields.getTextInputValue('content'),
      embed: embed === '1',
      mentionRoleId,
    });
    await interaction.reply(
      preview(
        announcement,
        `Draft #${announcement.id} for <#${channelId}>. Publish with \`/announce publish\` or \`/announce schedule\`.`,
      ),
    );
  },
};

const editModal: ComponentHandler = {
  prefix: 'announcements:edit',
  execute: async (interaction, args, ctx) => {
    if (!interaction.isModalSubmit()) {
      return;
    }
    const announcement = await requireEditable(
      interaction,
      ctx,
      Number(args[0]),
    );
    const title = interaction.fields.getTextInputValue('title').trim();
    const updated = {
      ...announcement,
      title: title === '' ? null : title,
      content: interaction.fields.getTextInputValue('content'),
    };
    render(updated); // Validates length before saving.
    await updateContent(ctx.db, announcement.id, updated);
    if (
      announcement.status === 'published' &&
      announcement.messageId !== null
    ) {
      const channel = await ctx.client.channels.fetch(announcement.channelId);
      if (channel?.isTextBased() === true) {
        await channel.messages.edit(announcement.messageId, {
          ...render(updated),
          allowedMentions: { parse: [] },
        });
      }
    }
    await interaction.reply({
      content: `Announcement #${announcement.id} updated.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

const idOption = (o: SlashCommandIntegerOption) =>
  o
    .setName('id')
    .setDescription('Announcement')
    .setRequired(true)
    .setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Create and publish announcements')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Draft an announcement')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post it')
          .setRequired(true)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
          ),
      )
      .addBooleanOption((o) =>
        o.setName('embed').setDescription('Post as an embed (default yes)'),
      )
      .addRoleOption((o) =>
        o.setName('mention').setDescription('Role to mention'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('preview')
      .setDescription('Preview privately')
      .addIntegerOption(idOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('publish')
      .setDescription('Publish now')
      .addIntegerOption(idOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('schedule')
      .setDescription('Publish later')
      .addIntegerOption(idOption)
      .addStringOption((o) =>
        o
          .setName('when')
          .setDescription('e.g. 2h, 2026-11-20 18:00')
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Edit the text')
      .addIntegerOption(idOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel a draft or schedule')
      .addIntegerOption(idOption),
  );

export const announcementsFeature: Feature = {
  name: 'announcements',
  permissions: [
    { id: 'announcement:create', description: 'Draft announcements' },
    {
      id: 'announcement:publish',
      description: 'Publish and edit any announcement',
    },
    { id: 'announcement:schedule', description: 'Schedule announcements' },
  ],
  jobs: [publishJob],
  components: [createModal, editModal],
  commands: [
    {
      data: data.toJSON(),
      permissions: {
        create: 'announcement:create',
        publish: 'announcement:publish',
        schedule: 'announcement:schedule',
      },
      execute: bySubcommand({
        create: async (interaction) => {
          const channel = interaction.options.getChannel('channel', true);
          const role = interaction.options.getRole('mention');
          checkMention(interaction.member, role?.id ?? null);
          const embed = interaction.options.getBoolean('embed') ?? true;
          const id = customId(
            'announcements:create',
            channel.id,
            embed ? 1 : 0,
            role?.id ?? '-',
          );
          await interaction.showModal(contentModal(id, 'New announcement'));
        },
        preview: async (interaction, ctx) => {
          const announcement = await requireEditable(
            interaction,
            ctx,
            interaction.options.getInteger('id', true),
          );
          await interaction.reply(
            preview(
              announcement,
              `Preview of #${announcement.id} (${announcement.status}):`,
            ),
          );
        },
        publish: async (interaction, ctx) => {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const id = interaction.options.getInteger('id', true);
          await requireAnnouncement(ctx.db, interaction.guildId, id);
          await ctx.scheduler.cancel(jobKey(id));
          const published = await publish(ctx, id, [
            'draft',
            'scheduled',
            'failed',
          ]);
          await interaction.editReply(
            `Published #${id} in <#${published.channelId}>.`,
          );
        },
        schedule: async (interaction, ctx) => {
          const id = interaction.options.getInteger('id', true);
          await requireAnnouncement(ctx.db, interaction.guildId, id);
          const zone = await getGuildTimezone(
            ctx.db,
            interaction.guildId,
            ctx.config.DEFAULT_TIMEZONE,
          );
          const runAt = parseFutureWhen(
            interaction.options.getString('when', true),
            zone,
          );
          const scheduled = await transition(
            ctx.db,
            id,
            ['draft', 'scheduled', 'failed'],
            {
              status: 'scheduled',
              scheduledAt: runAt,
              failure: null,
            },
          );
          if (!scheduled) {
            throw new UserError(
              `Announcement #${id} cannot be scheduled in its current state.`,
            );
          }
          await ctx.scheduler.schedule(
            publishJob,
            { announcementId: id },
            { runAt, key: jobKey(id) },
          );
          await respond(
            interaction,
            `Announcement #${id} will be published ${discordTime(runAt)}.`,
          );
        },
        edit: async (interaction, ctx) => {
          const announcement = await requireEditable(
            interaction,
            ctx,
            interaction.options.getInteger('id', true),
          );
          await interaction.showModal(
            contentModal(
              customId('announcements:edit', announcement.id),
              `Edit announcement #${announcement.id}`,
              announcement,
            ),
          );
        },
        cancel: async (interaction, ctx) => {
          const announcement = await requireEditable(
            interaction,
            ctx,
            interaction.options.getInteger('id', true),
          );
          const cancelled = await transition(
            ctx.db,
            announcement.id,
            ['draft', 'scheduled', 'failed'],
            {
              status: 'cancelled',
            },
          );
          if (!cancelled) {
            throw new UserError(
              `Announcement #${announcement.id} is already ${announcement.status}.`,
            );
          }
          await ctx.scheduler.cancel(jobKey(announcement.id));
          await respond(
            interaction,
            `Cancelled announcement #${announcement.id}.`,
          );
        },
      }),
      autocomplete: async (interaction, ctx) => {
        const rows = await listAnnouncements(ctx.db, interaction.guildId);
        await interaction.respond(
          rows.map((row) => ({
            name: `#${row.id} [${row.status}] ${row.title ?? row.content}`.slice(
              0,
              100,
            ),
            value: row.id,
          })),
        );
      },
    },
  ],
};
