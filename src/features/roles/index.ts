import {
  ChannelType,
  Events,
  InteractionContextType,
  SlashCommandBuilder,
  type GuildMember,
  type Role,
} from 'discord.js';
import { respond } from '~/core/discord/router';
import { bySubcommand, deferred, defineListener } from '~/core/define';
import type { CommandInteraction, Feature, SlashCommand } from '~/core/feature';
import { UserError } from '~/shared/errors';
import { requireAbove, requireEditable, requireSelfAssignable } from './guards';
import { handleReaction, syncLegacyPanel } from './legacy';
import { panelComponents, publishPanel } from './panels';
import {
  addPanelRole,
  createPanel,
  deletePanel,
  listPanels,
  listSelfAssignableRoles,
  removePanelRole,
  requirePanel,
  setPanelTitle,
} from './service';

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

async function memberAndRole(
  interaction: CommandInteraction,
): Promise<{ role: Role; member: GuildMember }> {
  const role = interaction.options.getRole('role', true);
  const user = interaction.options.getUser('member', true);

  requireAbove(interaction.member, role);
  requireEditable(role);
  if (
    role.permissions.has('Administrator') &&
    !interaction.member.permissions.has('Administrator')
  ) {
    throw new UserError(
      'Only administrators can hand out administrator roles.',
    );
  }

  return { role, member: await interaction.guild.members.fetch(user.id) };
}

const command = {
  data: data.toJSON(),
  permissions: {
    create: 'role:create',
    delete: 'role:manage',
    assign: 'role:assign',
    remove: 'role:assign',
    'panel create': 'role:manage',
    'panel update': 'role:manage',
    'panel remove': 'role:manage',
  },
  execute: bySubcommand({
    create: deferred(async (interaction) => {
      const role = await interaction.guild.roles.create({
        name: interaction.options.getString('name', true),
        permissions: [],
        mentionable: interaction.options.getBoolean('mentionable') ?? false,
        reason: `Requested by ${interaction.user.tag}`,
        ...(() => {
          const color = parseColor(interaction.options.getString('color'));

          return color === undefined ? {} : { colors: { primaryColor: color } };
        })(),
      });

      await respond(interaction, `Created ${role.toString()}.`);
    }),
    delete: deferred(async (interaction) => {
      const role = interaction.options.getRole('role', true);

      requireAbove(interaction.member, role);
      requireEditable(role);
      await role.delete(`Requested by ${interaction.user.tag}`);
      await respond(interaction, `Deleted ${role.name}.`);
    }),
    assign: deferred(async (interaction) => {
      const { role, member } = await memberAndRole(interaction);

      await member.roles.add(role, `Assigned by ${interaction.user.tag}`);
      await respond(
        interaction,
        `Gave ${role.toString()} to ${member.toString()}.`,
      );
    }),
    remove: deferred(async (interaction) => {
      const { role, member } = await memberAndRole(interaction);

      await member.roles.remove(role, `Removed by ${interaction.user.tag}`);
      await respond(
        interaction,
        `Removed ${role.toString()} from ${member.toString()}.`,
      );
    }),
    list: async (interaction, ctx) => {
      const [roles, panels] = await Promise.all([
        listSelfAssignableRoles(ctx.db, interaction.guildId),
        listPanels(ctx.db, interaction.guildId),
      ]);
      const lines = [
        '**Self-assignable roles**',
        ...(roles.length === 0
          ? ['None yet.']
          : roles.map((r) => `• <@&${r.roleId}>`)),
        '',
        '**Panels**',
        ...(panels.length === 0
          ? ['None yet.']
          : panels.map(
              (p) => `• #${p.id} ${p.title} (${p.kind}) in <#${p.channelId}>`,
            )),
      ];

      await respond(interaction, lines.join('\n'));
    },
    'panel create': deferred(async (interaction, ctx) => {
      const channel = interaction.options.getChannel('channel', true, [
        ChannelType.GuildText,
      ]);
      const id = await createPanel(ctx.db, {
        guildId: interaction.guildId,
        channelId: channel.id,
        kind: 'select',
        title: interaction.options.getString('title', true),
        createdBy: interaction.user.id,
      });

      await publishPanel(
        ctx,
        await requirePanel(ctx.db, interaction.guildId, id),
      );
      await respond(
        interaction,
        `Created panel #${id}. Add roles with \`/role panel update panel:${id} add:\`.`,
      );
    }),
    'panel update': deferred(async (interaction, ctx) => {
      const panel = await requirePanel(
        ctx.db,
        interaction.guildId,
        interaction.options.getInteger('panel', true),
      );

      if (panel.kind === 'reaction') {
        throw new UserError(
          'The legacy reaction panel is configured through environment variables.',
        );
      }

      const add = interaction.options.getRole('add');
      const remove = interaction.options.getRole('remove');
      const title = interaction.options.getString('title');

      if (add) {
        requireSelfAssignable(add);
        requireAbove(interaction.member, add);
        const label = interaction.options.getString('label') ?? add.name;

        await addPanelRole(ctx.db, panel.id, {
          roleId: add.id,
          label,
          emoji: null,
        });
      }

      if (remove && !(await removePanelRole(ctx.db, panel.id, remove.id))) {
        throw new UserError(`${remove.name} is not on this panel.`);
      }

      if (title !== null) {
        await setPanelTitle(ctx.db, panel.id, title);
      }

      await publishPanel(
        ctx,
        await requirePanel(ctx.db, interaction.guildId, panel.id),
      );
      await respond(interaction, `Panel #${panel.id} updated.`);
    }),
    'panel remove': deferred(async (interaction, ctx) => {
      const panel = await requirePanel(
        ctx.db,
        interaction.guildId,
        interaction.options.getInteger('panel', true),
      );

      if (panel.messageId !== null) {
        const channel = await ctx.client.channels
          .fetch(panel.channelId)
          .catch(() => null);

        if (channel?.isTextBased() === true) {
          await channel.messages.delete(panel.messageId).catch(() => null);
        }
      }

      await deletePanel(ctx.db, panel.id);
      const note =
        panel.kind === 'reaction'
          ? ' Unset ROLE_SELECTION_CHANNEL_ID, or it will be posted again on the next start.'
          : '';

      await respond(interaction, `Removed panel #${panel.id}.${note}`);
    }),
  }),
  autocomplete: async (interaction, ctx) => {
    const query = interaction.options.getFocused().toLowerCase();
    const panels = await listPanels(ctx.db, interaction.guildId);

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
} satisfies SlashCommand;

export const rolesFeature: Feature = {
  name: 'roles',
  permissions: [
    { id: 'role:create', description: 'Create roles' },
    { id: 'role:manage', description: 'Delete roles and manage role panels' },
    { id: 'role:assign', description: 'Assign roles to other members' },
  ],
  commands: [command],
  components: panelComponents,
  events: [
    defineListener(Events.MessageReactionAdd, (ctx, reaction, user) =>
      handleReaction(ctx, reaction, user, true),
    ),
    defineListener(Events.MessageReactionRemove, (ctx, reaction, user) =>
      handleReaction(ctx, reaction, user, false),
    ),
  ],
  start: syncLegacyPanel,
};
