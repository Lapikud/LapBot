import {
  ChannelSelectMenuBuilder,
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Announcement } from '~/features/announcements/model';
import {
  maxAnnouncementLength,
  type AnnouncementService,
} from '~/features/announcements/service';
import {
  channelMention,
  controlId,
  maxContentLength,
  splitContent,
  type Message,
} from '~/core/message';
import { discordTime } from '~/core/helpers/time';
import { UserError } from '~/core/errors';
import { toActor } from '~/discord/interactions/actor';
import { mentionInputs, mentionsOf } from '~/discord/interactions/mentions';
import { bySubcommand } from './handlers';
import type { ComponentHandler, Feature } from '~/discord/contracts';
import { render } from '~/discord/render';
import { respond, respondView } from '~/discord/interactions/responses';

const postChannels = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
] as const;

function editModal(announcement: Announcement): ModalBuilder {
  const published = announcement.status === 'published';
  const modal = contentModal(
    controlId(
      'announcements:edit',
      announcement.id,
      published ? 'text' : 'all',
    ),
    `Edit announcement #${announcement.id}`,
    announcement,
  );

  return published
    ? modal
    : modal.addLabelComponents(
        new LabelBuilder().setLabel('Channel').setChannelSelectMenuComponent(
          new ChannelSelectMenuBuilder()
            .setCustomId('channel')
            .setChannelTypes(...postChannels)
            .setDefaultChannels(announcement.channelId),
        ),
        ...mentionInputs(announcement.mentions),
      );
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

const data = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Write an announcement')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Write, preview and publish an announcement')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post it')
          .setRequired(true)
          .addChannelTypes(...postChannels),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Edit an announcement')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Announcement')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

export function announcementCommands(
  announcements: AnnouncementService,
): Feature {
  const draftView = (announcement: Announcement): Message => {
    const [first, ...rest] = announcements.view(announcement);
    const heading = `-# Preview for ${channelMention(announcement.channelId)}`;
    const plural = rest.length === 1 ? '' : 's';
    const more =
      rest.length === 0
        ? ''
        : `\n-# Continues in ${rest.length} more message${plural}`;
    const [body = ''] = splitContent(
      first?.content ?? '',
      maxContentLength - heading.length - more.length - 1,
    );
    const action = (name: string) =>
      controlId('announcements:act', announcement.id, name);

    return {
      ...first,
      content: `${heading}\n${body}${more}`,
      controls: [
        [
          {
            kind: 'button',
            id: action('publish'),
            label: 'Publish now',
            style: 'primary',
          },
          {
            kind: 'button',
            id: action('schedule'),
            label: 'Schedule…',
            style: 'secondary',
          },
          {
            kind: 'button',
            id: action('edit'),
            label: 'Edit',
            style: 'secondary',
          },
          {
            kind: 'button',
            id: action('discard'),
            label: 'Discard',
            style: 'danger',
          },
        ],
      ],
    };
  };

  const done = (content: string) => ({ content, embeds: [], components: [] });

  const create: ComponentHandler = {
    prefix: 'announcements:create',
    execute: async (interaction, [channelId = '']) => {
      if (!interaction.isModalSubmit()) {
        return;
      }

      const actor = toActor(interaction.member);
      const announcement = await announcements.draft(actor, {
        channelId,
        title: interaction.fields.getTextInputValue('title'),
        content: interaction.fields.getTextInputValue('content'),
        mentions: mentionsOf(interaction.fields),
      });

      await respondView(interaction, draftView(announcement));
    },
  };

  const act: ComponentHandler = {
    prefix: 'announcements:act',
    execute: async (interaction, [rawId, name]) => {
      const id = Number(rawId);

      if (!interaction.isButton() || !Number.isSafeInteger(id)) {
        throw new UserError('This button is invalid.');
      }

      const actor = toActor(interaction.member);

      if (name === 'publish') {
        const published = await announcements.publish(actor, id);

        await interaction.update(
          done(`Published in ${channelMention(published.channelId)}.`),
        );
      } else if (name === 'schedule') {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId(controlId('announcements:when', id))
            .setTitle('Schedule announcement')
            .addLabelComponents(
              new LabelBuilder()
                .setLabel('When')
                .setDescription('e.g. tomorrow 18:00, fri 9:00, 20/11 18:00')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('when')
                    .setStyle(TextInputStyle.Short),
                ),
            ),
        );
      } else if (name === 'edit') {
        await interaction.showModal(
          editModal(await announcements.get(actor, id)),
        );
      } else if (name === 'discard') {
        await announcements.cancel(actor, id);
        await interaction.update(done('Discarded.'));
      } else {
        throw new UserError('This button is invalid.');
      }
    },
  };

  const when: ComponentHandler = {
    prefix: 'announcements:when',
    execute: async (interaction, [id]) => {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) {
        return;
      }

      const scheduled = await announcements.schedule(
        toActor(interaction.member),
        Number(id),
        interaction.fields.getTextInputValue('when'),
      );

      await interaction.update(
        done(
          `Will be posted in ${channelMention(scheduled.channelId)} ${discordTime(scheduled.scheduledAt ?? new Date())}.`,
        ),
      );
    },
  };

  const edit: ComponentHandler = {
    prefix: 'announcements:edit',
    execute: async (interaction, [id, scope]) => {
      if (!interaction.isModalSubmit()) {
        return;
      }

      const actor = toActor(interaction.member);
      const { fields } = interaction;
      const channelId =
        scope === 'all'
          ? fields.getSelectedChannels('channel', true).firstKey()
          : undefined;
      const updated = await announcements.edit(actor, Number(id), {
        title: fields.getTextInputValue('title'),
        content: fields.getTextInputValue('content'),
        ...(channelId !== undefined && {
          channelId,
          mentions: mentionsOf(fields),
        }),
      });

      if (interaction.isFromMessage() && updated.status === 'draft') {
        const { content, components } = render(draftView(updated));

        await interaction.update({ content, components });

        return;
      }

      await respond(interaction, 'Announcement updated.');
    },
  };

  return {
    name: 'announcements',
    permissions: [
      {
        id: 'announcement:post',
        description: 'Write, publish, schedule and edit announcements',
      },
    ],
    components: [create, act, when, edit],
    commands: [
      {
        data: data.toJSON(),
        permissions: { create: 'announcement:post', edit: 'announcement:post' },
        execute: bySubcommand({
          create: async (interaction) => {
            const channel = interaction.options.getChannel('channel', true);

            await interaction.showModal(
              contentModal(
                controlId('announcements:create', channel.id),
                'New announcement',
              ).addLabelComponents(...mentionInputs()),
            );
          },
          edit: async (interaction) => {
            const announcement = await announcements.get(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
            );

            await interaction.showModal(editModal(announcement));
          },
        }),
        autocomplete: async (interaction) => {
          const rows = await announcements.list(toActor(interaction.member));

          await interaction.respond(
            rows
              .filter((row) => row.status !== 'cancelled')
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
