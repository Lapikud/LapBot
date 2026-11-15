import {
  InteractionContextType,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from 'discord.js';
import type { PermissionService } from '~/core/services';
import { managePermissions, roleMention, userMention } from '~/domain';
import { toActor } from '../actor';
import { bySubcommand, deferred } from '../define';
import type { Feature } from '../module';
import { respond } from '../router';

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

export function permissionCommands(permissions: PermissionService): Feature {
  const change = (action: 'grant' | 'revoke') =>
    deferred(async (interaction) => {
      const role = interaction.options.getRole('role', true);
      const permission = interaction.options.getString('permission', true);
      const changed = await permissions[action](
        toActor(interaction.member),
        role.id,
        permission,
      );
      const verb = action === 'grant' ? 'Granted' : 'Revoked';

      await respond(
        interaction,
        changed
          ? `${verb} "${permission}" for ${roleMention(role.id)}.`
          : 'Nothing changed.',
      );
    });

  return {
    name: 'permissions',
    permissions: [
      {
        id: managePermissions,
        description: 'Grant and revoke bot permissions',
      },
    ],
    commands: [
      {
        data: data.toJSON(),
        execute: bySubcommand({
          grant: change('grant'),
          revoke: change('revoke'),
          list: async (interaction) => {
            const role = interaction.options.getRole('role');
            const grants = await permissions.list(
              toActor(interaction.member),
              ...(role ? [role.id] : []),
            );
            const lines = grants.map(
              (g) => `${roleMention(g.roleId)} — "${g.permission}"`,
            );

            await respond(
              interaction,
              lines.length === 0
                ? 'No permissions granted. Administrators hold every permission.'
                : lines.join('\n').slice(0, 2000),
            );
          },
          check: deferred(async (interaction) => {
            const user = interaction.options.getUser('member', true);
            const permission = interaction.options.getString(
              'permission',
              true,
            );
            const holds = await permissions.check(
              toActor(interaction.member),
              user.id,
              permission,
            );

            await respond(
              interaction,
              `${userMention(user.id)} ${holds ? 'holds' : 'does not hold'} "${permission}".`,
            );
          }),
        }),
        autocomplete: async (interaction) => {
          const query = interaction.options.getFocused().toLowerCase();

          await interaction.respond(
            permissions
              .catalogue()
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
