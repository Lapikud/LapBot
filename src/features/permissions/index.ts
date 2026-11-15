import {
  InteractionContextType,
  SlashCommandBuilder,
  type GuildMember,
  type Role,
  type SlashCommandStringOption,
} from 'discord.js';
import { respond } from '~/core/discord/router';
import { bySubcommand, deferred } from '~/core/define';
import type {
  AppContext,
  CommandInteraction,
  Feature,
  Permission,
  PermissionDefinition,
} from '~/core/feature';
import { isAdministrator } from '~/core/permissions/authorizer';
import { grant, listGrants, revoke } from '~/core/permissions/store';
import { UserError } from '~/shared/errors';

const managePermission: Permission = 'permissions:manage';

const permissionOption = (o: SlashCommandStringOption) =>
  o
    .setName('permission')
    .setDescription('Permission')
    .setRequired(true)
    .setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('permissions')
  .setDescription('Manage which roles may use restricted bot actions')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('grant')
      .setDescription('Grant a permission to a role')
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role').setRequired(true),
      )
      .addStringOption(permissionOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('revoke')
      .setDescription('Revoke a permission from a role')
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role').setRequired(true),
      )
      .addStringOption(permissionOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List granted permissions')
      .addRoleOption((o) => o.setName('role').setDescription('Only this role')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('check')
      .setDescription('Check whether a member holds a permission')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member').setRequired(true),
      )
      .addStringOption(permissionOption),
  );

export async function checkDelegation(
  ctx: Pick<AppContext, 'authz'>,
  actor: GuildMember,
  role: Role,
  permission: Permission,
): Promise<void> {
  if (isAdministrator(actor)) {
    return;
  }

  if (permission === managePermission) {
    throw new UserError(
      'Only administrators can delegate permission management.',
    );
  }

  if (actor.roles.highest.comparePositionTo(role) <= 0) {
    throw new UserError(`${role.name} is not below your highest role.`);
  }

  if (!(await ctx.authz.can(actor, permission))) {
    throw new UserError('You can only grant permissions you hold yourself.');
  }
}

export function createPermissionsFeature(
  known: () => ReadonlyMap<Permission, PermissionDefinition>,
): Feature {
  const readPermission = (interaction: CommandInteraction): Permission => {
    const value = interaction.options.getString('permission', true);
    const definition = [...known().values()].find((p) => p.id === value);

    if (!definition) {
      throw new UserError(`Unknown permission \`${value}\`.`);
    }

    return definition.id;
  };

  const change =
    (action: 'grant' | 'revoke') =>
    async (interaction: CommandInteraction, ctx: AppContext) => {
      const role = interaction.options.getRole('role', true);
      const permission = readPermission(interaction);

      await checkDelegation(ctx, interaction.member, role, permission);
      const input = {
        guildId: interaction.guildId,
        roleId: role.id,
        permission,
      };
      const changed =
        action === 'grant'
          ? await grant(ctx.db, { ...input, grantedBy: interaction.user.id })
          : await revoke(ctx.db, input);

      ctx.log.info(
        { ...input, actorId: interaction.user.id, action, changed },
        'Permission change',
      );
      const verb = action === 'grant' ? 'Granted' : 'Revoked';

      await respond(
        interaction,
        changed
          ? `${verb} \`${permission}\` for ${role.toString()}.`
          : 'Nothing changed.',
      );
    };

  return {
    name: 'permissions',
    permissions: [
      { id: managePermission, description: 'Grant and revoke bot permissions' },
    ],
    commands: [
      {
        data: data.toJSON(),
        permissions: { '*': managePermission },
        execute: bySubcommand({
          grant: change('grant'),
          revoke: change('revoke'),
          list: async (interaction, ctx) => {
            const role = interaction.options.getRole('role');
            const grants = await listGrants(
              ctx.db,
              interaction.guildId,
              role?.id,
            );
            const lines = grants.map(
              (g) => `<@&${g.roleId}> — \`${g.permission}\``,
            );

            await respond(
              interaction,
              lines.length === 0
                ? 'No permissions granted. Administrators hold every permission.'
                : lines.join('\n').slice(0, 2000),
            );
          },
          check: deferred(async (interaction, ctx) => {
            const user = interaction.options.getUser('member', true);
            const member = await interaction.guild.members.fetch(user.id);
            const permission = readPermission(interaction);
            const allowed = await ctx.authz.can(member, permission);

            await respond(
              interaction,
              `${member.toString()} ${allowed ? 'holds' : 'does not hold'} \`${permission}\`.`,
            );
          }),
        }),
        autocomplete: async (interaction) => {
          const query = interaction.options.getFocused().toLowerCase();

          await interaction.respond(
            [...known().values()]
              .filter(
                (p) =>
                  p.id.includes(query) ||
                  p.description.toLowerCase().includes(query),
              )
              .slice(0, 25)
              .map((p) => ({
                name: `${p.id} — ${p.description}`.slice(0, 100),
                value: p.id,
              })),
          );
        },
      },
    ],
  };
}
