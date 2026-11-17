import {
  InteractionContextType,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from 'discord.js';
import type { PermissionService } from './service';
import { managePermissions } from '~/core/permission';
import { roleMention } from '~/core/message';
import { toActor } from '~/integrations/discord/actor';
import { bySubcommand, deferred } from '~/integrations/discord/define';
import type { Feature } from '~/integrations/discord/module';
import { respond } from '~/integrations/discord/router';

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
