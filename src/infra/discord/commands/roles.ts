import {
  ChannelType,
  Events,
  InteractionContextType,
  SlashCommandBuilder,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import type { RoleService } from '~/core/services';
import { channelMention, roleMention, userMention, UserError } from '~/domain';
import { toActor } from '../actor';
import { bySubcommand, deferred, defineListener } from '../define';
import type { ComponentHandler, Feature, SlashCommand } from '../module';
import { respond, respondView } from '../router';

const data = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Manage roles and role panels')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Create a role without permissions')
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Role name')
          .setRequired(true)
          .setMaxLength(100),
      )
      .addStringOption((o) =>
        o.setName('color').setDescription('Hex color, e.g. #FFAC1C'),
      )
      .addBooleanOption((o) =>
        o.setName('mentionable').setDescription('Allow anyone to mention it'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('Delete a role')
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('assign')
      .setDescription('Give a member a role')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member').setRequired(true),
      )
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Take a role from a member')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member').setRequired(true),
      )
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List self-assignable roles and panels'),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('panel')
      .setDescription('Role selection panels')
      .addSubcommand((sub) =>
        sub
          .setName('create')
          .setDescription('Post a new role panel')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((o) =>
            o
              .setName('title')
              .setDescription('Panel title')
              .setRequired(true)
              .setMaxLength(200),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('update')
          .setDescription('Add or remove roles, or rename a panel')
          .addIntegerOption((o) =>
            o
              .setName('panel')
              .setDescription('Panel')
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addRoleOption((o) => o.setName('add').setDescription('Role to add'))
          .addStringOption((o) =>
            o
              .setName('label')
              .setDescription('Label for the added role')
              .setMaxLength(100),
          )
          .addRoleOption((o) =>
            o.setName('remove').setDescription('Role to remove'),
          )
          .addStringOption((o) =>
            o.setName('title').setDescription('New title').setMaxLength(200),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription(
            'Delete a panel and its message (including the legacy reaction panel)',
          )
          .addIntegerOption((o) =>
            o
              .setName('panel')
              .setDescription('Panel')
              .setRequired(true)
              .setAutocomplete(true),
          ),
      ),
  );

function parseColor(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const match = /^#?([\da-f]{6})$/i.exec(value);

  if (match?.[1] === undefined) {
    throw new UserError('Color must be a hex value like #FFAC1C.');
  }

  return Number.parseInt(match[1], 16);
}

function panelId(args: readonly string[]): number {
  const id = Number(args[0]);

  if (!Number.isSafeInteger(id)) {
    throw new UserError('This role panel is invalid.');
  }

  return id;
}

function reactionOf(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) {
  const { message } = reaction;
  const emoji = reaction.emoji.name;

  if (user.bot || message.guildId === null || emoji === null) {
    return null;
  }

  return {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    emoji,
    userId: user.id,
  };
}

export function roleCommands(roles: RoleService): Feature {
  const command: SlashCommand = {
    data: data.toJSON(),
    execute: bySubcommand({
      create: deferred(async (interaction) => {
        const color = parseColor(interaction.options.getString('color'));
        const role = await roles.createRole(toActor(interaction.member), {
          name: interaction.options.getString('name', true),
          mentionable: interaction.options.getBoolean('mentionable') ?? false,
          ...(color !== undefined && { color }),
        });

        await respond(interaction, `Created ${roleMention(role.id)}.`);
      }),
      delete: deferred(async (interaction) => {
        const role = interaction.options.getRole('role', true);
        const deleted = await roles.deleteRole(
          toActor(interaction.member),
          role.id,
        );

        await respond(interaction, `Deleted ${deleted.name}.`);
      }),
      assign: deferred(async (interaction) => {
        const role = interaction.options.getRole('role', true);
        const user = interaction.options.getUser('member', true);

        await roles.assign(toActor(interaction.member), user.id, role.id);
        await respond(
          interaction,
          `Gave ${roleMention(role.id)} to ${userMention(user.id)}.`,
        );
      }),
      remove: deferred(async (interaction) => {
        const role = interaction.options.getRole('role', true);
        const user = interaction.options.getUser('member', true);

        await roles.unassign(toActor(interaction.member), user.id, role.id);
        await respond(
          interaction,
          `Removed ${roleMention(role.id)} from ${userMention(user.id)}.`,
        );
      }),
      list: async (interaction) => {
        const overview = await roles.overview(interaction.guildId);
        const lines = [
          '**Self-assignable roles**',
          ...(overview.roles.length === 0
            ? ['None yet.']
            : overview.roles.map((id) => `• ${roleMention(id)}`)),
          '',
          '**Panels**',
          ...(overview.panels.length === 0
            ? ['None yet.']
            : overview.panels.map(
                (p) =>
                  `• #${p.id} ${p.title} (${p.kind}) in ${channelMention(p.channelId)}`,
              )),
        ];

        await respond(interaction, lines.join('\n'));
      },
      'panel create': deferred(async (interaction) => {
        const channel = interaction.options.getChannel('channel', true, [
          ChannelType.GuildText,
        ]);
        const id = await roles.createPanel(
          toActor(interaction.member),
          channel.id,
          interaction.options.getString('title', true),
        );

        await respond(
          interaction,
          `Created panel #${id}. Add roles with "/role panel update panel:${id} add:".`,
        );
      }),
      'panel update': deferred(async (interaction) => {
        const add = interaction.options.getRole('add');
        const remove = interaction.options.getRole('remove');
        const title = interaction.options.getString('title');
        const id = interaction.options.getInteger('panel', true);

        await roles.updatePanel(toActor(interaction.member), id, {
          ...(add && {
            add: {
              roleId: add.id,
              label: interaction.options.getString('label') ?? add.name,
              emoji: null,
            },
          }),
          ...(remove && { remove: remove.id }),
          ...(title !== null && { title }),
        });
        await respond(interaction, `Panel #${id} updated.`);
      }),
      'panel remove': deferred(async (interaction) => {
        const panel = await roles.removePanel(
          toActor(interaction.member),
          interaction.options.getInteger('panel', true),
        );
        const note =
          panel.kind === 'reaction'
            ? ' Unset ROLE_SELECTION_CHANNEL_ID, or it will be posted again on the next start.'
            : '';

        await respond(interaction, `Removed panel #${panel.id}.${note}`);
      }),
    }),
    autocomplete: async (interaction) => {
      const query = interaction.options.getFocused().toLowerCase();
      const panels = await roles.panels(interaction.guildId);

      await interaction.respond(
        panels
          .filter(
            (p) =>
              p.title.toLowerCase().includes(query) || String(p.id) === query,
          )
          .slice(0, 25)
          .map((p) => ({
            name: `#${p.id} ${p.title}`.slice(0, 100),
            value: p.id,
          })),
      );
    },
  };

  const open: ComponentHandler = {
    prefix: 'roles:open',
    execute: async (interaction, args) => {
      await respondView(
        interaction,
        await roles.open(toActor(interaction.member), panelId(args)),
      );
    },
  };

  const choose: ComponentHandler = {
    prefix: 'roles:choose',
    execute: async (interaction, args) => {
      if (!interaction.isStringSelectMenu()) {
        return;
      }

      await interaction.deferUpdate();

      const result = await roles.choose(
        toActor(interaction.member),
        panelId(args),
        interaction.values,
      );
      const lines = [
        result.changed === 0 ? 'No changes.' : 'Your roles are updated.',
        ...(result.skipped.length > 0
          ? [`Unavailable right now: ${result.skipped.join(', ')}`]
          : []),
      ];

      await interaction.editReply({
        content: lines.join('\n'),
        components: [],
      });
    },
  };

  const added = defineListener(
    Events.MessageReactionAdd,
    async (_ctx, reaction, user) => {
      const key = reactionOf(reaction, user);

      if (key) {
        await roles.reacted(key, true);
      }
    },
  );
  const removed = defineListener(
    Events.MessageReactionRemove,
    async (_ctx, reaction, user) => {
      const key = reactionOf(reaction, user);

      if (key) {
        await roles.reacted(key, false);
      }
    },
  );

  return {
    name: 'roles',
    permissions: [
      { id: 'role:create', description: 'Create roles' },
      { id: 'role:manage', description: 'Delete roles and manage role panels' },
      { id: 'role:assign', description: 'Assign roles to other members' },
    ],
    commands: [command],
    components: [open, choose],
    events: [added, removed],
    start: () => roles.syncLegacyPanel(),
  };
}
