import {
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Post } from '~/domain/posts';
import { maxPostLength, type PostService } from '~/core/posts';
import {
  channelMention,
  controlId,
  discordTime,
  UserError,
  type Actor,
  type Message,
} from '~/domain';
import { toActor } from '../actor';
import { bySubcommand } from '../define';
import type { AppContext, ComponentHandler, Feature } from '../module';
import { render } from '../render';
import { respond, respondView } from '../router';

function contentModal(id: string, title: string, current?: Post): ModalBuilder {
  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256);
  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(maxPostLength);

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
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Fix the text of an announcement')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Announcement')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

export function announcementCommands(announcements: PostService): Feature {
  const draftView = async (
    announcement: Post,
    actor: Actor,
    ctx: AppContext,
  ): Promise<Message> => {
    const view = announcements.view(announcement);
    const action = (name: string) =>
      controlId('announcements:act', announcement.id, name);
    const [canPublish, canSchedule] = await Promise.all([
      ctx.authz.can(actor, 'announcement:publish'),
      ctx.authz.can(actor, 'announcement:schedule'),
    ]);

    return {
      ...view,
      content: `-# Preview for ${channelMention(announcement.channelId)}\n${view.content ?? ''}`,
      controls: [
        [
          ...(canPublish
            ? [
                {
                  kind: 'button' as const,
                  id: action('publish'),
                  label: 'Publish now',
                  style: 'primary' as const,
                },
              ]
            : []),
          ...(canSchedule
            ? [
                {
                  kind: 'button' as const,
                  id: action('schedule'),
                  label: 'Schedule…',
                  style: 'secondary' as const,
                },
              ]
            : []),
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
    execute: async (interaction, [channelId = ''], ctx) => {
      if (!interaction.isModalSubmit()) {
        return;
      }

      const actor = toActor(interaction.member);
      const roles = interaction.fields.getSelectedRoles('mentions');
      const announcement = await announcements.draft(actor, {
        channelId,
        title: interaction.fields.getTextInputValue('title'),
        content: interaction.fields.getTextInputValue('content'),
        mentionRoleIds: roles ? [...roles.keys()] : [],
        mentionEveryone: interaction.fields
          .getStringSelectValues('everyone')
          .includes('everyone'),
      });

      await respondView(interaction, await draftView(announcement, actor, ctx));
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
                .setDescription('e.g. tomorrow 18:00, fri 9:00, 20.11 18:00')
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId('when')
                    .setStyle(TextInputStyle.Short),
                ),
            ),
        );
      } else if (name === 'edit') {
        await interaction.showModal(
          contentModal(
            controlId('announcements:edit', id),
            'Edit announcement',
            await announcements.get(actor, id),
          ),
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
    execute: async (interaction, [id], ctx) => {
      if (!interaction.isModalSubmit()) {
        return;
      }

      const actor = toActor(interaction.member);
      const updated = await announcements.edit(actor, Number(id), {
        title: interaction.fields.getTextInputValue('title'),
        content: interaction.fields.getTextInputValue('content'),
      });

      if (interaction.isFromMessage() && updated.status === 'draft') {
        const { content, components } = render(
          await draftView(updated, actor, ctx),
        );

        await interaction.update({ content, components });

        return;
      }

      await respond(interaction, 'Announcement updated.');
    },
  };

  return {
    name: 'announcements',
    permissions: [
      { id: 'announcement:create', description: 'Write announcements' },
      {
        id: 'announcement:publish',
        description: 'Publish and edit any announcement',
      },
      { id: 'announcement:schedule', description: 'Schedule announcements' },
    ],
    components: [create, act, when, edit],
    commands: [
      {
        data: data.toJSON(),
        permissions: { create: 'announcement:create' },
        execute: bySubcommand({
          create: async (interaction) => {
            const channel = interaction.options.getChannel('channel', true);

            await interaction.showModal(
              contentModal(
                controlId('announcements:create', channel.id),
                'New announcement',
              ).addLabelComponents(
                new LabelBuilder()
                  .setLabel('Mention roles')
                  .setRoleSelectMenuComponent(
                    new RoleSelectMenuBuilder()
                      .setCustomId('mentions')
                      .setRequired(false)
                      .setMaxValues(25),
                  ),
                new LabelBuilder()
                  .setLabel('Mention everyone')
                  .setStringSelectMenuComponent(
                    new StringSelectMenuBuilder()
                      .setCustomId('everyone')
                      .setRequired(false)
                      .addOptions({ label: '@everyone', value: 'everyone' }),
                  ),
              ),
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
