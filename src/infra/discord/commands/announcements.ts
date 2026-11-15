import {
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type SlashCommandIntegerOption,
} from 'discord.js';
import type { Announcement } from '~/core/ports';
import {
  maxAnnouncementLength,
  type AnnouncementService,
} from '~/core/services';
import { channelMention, controlId, discordTime } from '~/domain';
import { toActor } from '../actor';
import { bySubcommand, deferred } from '../define';
import type { ComponentHandler, Feature } from '../module';
import { respond, respondView } from '../router';

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
    .setMaxLength(maxAnnouncementLength);

  if (current?.title !== undefined && current.title !== null) {
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

export function announcementCommands(
  announcements: AnnouncementService,
): Feature {
  const preview = (announcement: Announcement, note: string) => {
    const view = announcements.view(announcement);

    return {
      ...view,
      content: [note, view.content].filter(Boolean).join('\n\n'),
    };
  };

  const create: ComponentHandler = {
    prefix: 'announcements:create',
    execute: async (interaction, args) => {
      if (!interaction.isModalSubmit()) {
        return;
      }

      const [channelId = '', embed, role = '-'] = args;
      const everyone = role === interaction.guildId;
      const announcement = await announcements.draft(
        toActor(interaction.member),
        {
          channelId,
          title: interaction.fields.getTextInputValue('title'),
          content: interaction.fields.getTextInputValue('content'),
          embed: embed === '1',
          mentionRoleIds: role === '-' || everyone ? [] : [role],
          mentionEveryone: everyone,
        },
      );

      await respondView(
        interaction,
        preview(
          announcement,
          `Draft #${announcement.id} for ${channelMention(channelId)}. Publish with "/announce publish" or "/announce schedule".`,
        ),
      );
    },
  };

  const edit: ComponentHandler = {
    prefix: 'announcements:edit',
    execute: async (interaction, [id]) => {
      if (!interaction.isModalSubmit()) {
        return;
      }

      const updated = await announcements.edit(
        toActor(interaction.member),
        Number(id),
        {
          title: interaction.fields.getTextInputValue('title'),
          content: interaction.fields.getTextInputValue('content'),
        },
      );

      await respond(interaction, `Announcement #${updated.id} updated.`);
    },
  };

  return {
    name: 'announcements',
    permissions: [
      { id: 'announcement:create', description: 'Draft announcements' },
      {
        id: 'announcement:publish',
        description: 'Publish and edit any announcement',
      },
      { id: 'announcement:schedule', description: 'Schedule announcements' },
    ],
    components: [create, edit],
    commands: [
      {
        data: data.toJSON(),
        permissions: { create: 'announcement:create' },
        execute: bySubcommand({
          create: async (interaction) => {
            const channel = interaction.options.getChannel('channel', true);
            const role = interaction.options.getRole('mention');
            const embed = interaction.options.getBoolean('embed') ?? true;

            await interaction.showModal(
              contentModal(
                controlId(
                  'announcements:create',
                  channel.id,
                  embed ? 1 : 0,
                  role?.id ?? '-',
                ),
                'New announcement',
              ),
            );
          },
          preview: async (interaction) => {
            const announcement = await announcements.get(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
            );

            await respondView(
              interaction,
              preview(
                announcement,
                `Preview of #${announcement.id} (${announcement.status}):`,
              ),
            );
          },
          publish: deferred(async (interaction) => {
            const published = await announcements.publish(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
            );

            await respond(
              interaction,
              `Published #${published.id} in ${channelMention(published.channelId)}.`,
            );
          }),
          schedule: async (interaction) => {
            const scheduled = await announcements.schedule(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
              interaction.options.getString('when', true),
            );

            await respond(
              interaction,
              `Announcement #${scheduled.id} will be published ${discordTime(scheduled.scheduledAt ?? new Date())}.`,
            );
          },
          edit: async (interaction) => {
            const announcement = await announcements.get(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
            );

            await interaction.showModal(
              contentModal(
                controlId('announcements:edit', announcement.id),
                `Edit announcement #${announcement.id}`,
                announcement,
              ),
            );
          },
          cancel: async (interaction) => {
            const cancelled = await announcements.cancel(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
            );

            await respond(
              interaction,
              `Cancelled announcement #${cancelled.id}.`,
            );
          },
        }),
        autocomplete: async (interaction) => {
          const rows = await announcements.list(interaction.guildId);

          await interaction.respond(
            rows
              .filter((row) =>
                ['draft', 'scheduled', 'failed'].includes(row.status),
              )
              .slice(0, 25)
              .map((row) => ({
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
}
