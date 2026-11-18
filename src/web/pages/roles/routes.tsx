import { Hono } from 'hono';
import { UserError } from '~/core/errors';
import { selfAssignProblem } from '~/core/helpers/roles';
import { back, field, flashOf, type Env, type WebDeps } from '~/web/context';
import { emojis } from './emoji-select';
import { RolePage } from './index';
import { panelChoices } from './submission';

export function roleRoutes({ services }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const panels = await services.roles.list(c.var.actor);
      const server = await c.var.server();
      const channelId =
        c.req.query('channel') ??
        panels[0]?.channelId ??
        server.channels[0]?.id;
      const panel = panels.find((p) => p.channelId === channelId);
      const entries = panel?.roles ?? [];
      const selected = new Set(entries.map((entry) => entry.roleId));
      const used = new Set(entries.map((entry) => entry.emoji));
      const assignable = server.roles.filter(
        (role) => selfAssignProblem(role) === undefined,
      );
      const assignableIds = new Set(assignable.map((role) => role.id));
      const unavailable = entries.filter(
        (entry) => !assignableIds.has(entry.roleId),
      );
      const available = assignable
        .filter((role) => !selected.has(role.id))
        .toSorted((a, b) => a.name.localeCompare(b.name));
      const nextEmoji =
        emojis.find(
          (emoji) => !entries.some((entry) => entry.emoji === emoji),
        ) ?? '⭐';

      return c.html(
        <RolePage
          channelId={channelId}
          unavailable={unavailable}
          panel={panel}
          entries={entries}
          available={available}
          nextEmoji={nextEmoji}
          used={used}
          server={server}
          guildId={c.var.actor.guildId}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      );
    })
    .post('/', async (c) => {
      const form = await c.req.formData();
      const channelId = field(form, 'channelId');

      if (channelId === undefined) {
        throw new UserError('Choose a channel.');
      }

      const remove = field(form, 'remove');
      const choices = panelChoices(form, remove);

      const newRole = field(form, 'new-role');

      if (
        remove === undefined &&
        (newRole !== undefined || field(form, 'action') === 'add')
      ) {
        if (newRole === undefined) {
          throw new UserError('Choose the role you want to add.');
        }

        const used = new Set(choices.map((choice) => choice.emoji));
        const emoji =
          field(form, 'new-emoji') ??
          emojis.find((candidate) => !used.has(candidate));

        if (emoji === undefined) {
          throw new UserError('This panel is full.');
        }

        choices.push({ roleId: newRole, emoji });
      }

      let wanted = choices;

      if (remove === 'unavailable') {
        const server = await c.var.server();
        const assignableIds = new Set(
          server.roles
            .filter((role) => selfAssignProblem(role) === undefined)
            .map((role) => role.id),
        );

        wanted = choices.filter((choice) => assignableIds.has(choice.roleId));
      }

      await services.roles.save(c.var.actor, channelId, wanted);

      return back(c, `/roles?channel=${encodeURIComponent(channelId)}`, {
        notice:
          remove !== undefined
            ? 'Role removed from the panel.'
            : 'Reaction panel saved.',
      });
    });
}
