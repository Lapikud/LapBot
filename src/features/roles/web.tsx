import { Select } from '~/core/ui/controls';
import { Hono } from 'hono';
import { selfAssignProblem } from '~/core/helpers/roles';
import { UserError } from '~/core/errors';
import {
  back,
  field,
  flashOf,
  type Env,
  type WebDeps,
} from '~/integrations/web/context';
import { Layout } from '~/integrations/web/layout';
import { ChannelSelect } from '~/integrations/web/selectors';

const emojis = [
  '1️⃣',
  '2️⃣',
  '3️⃣',
  '4️⃣',
  '5️⃣',
  '6️⃣',
  '7️⃣',
  '8️⃣',
  '9️⃣',
  '🔟',
  '🎉',
  '💻',
  '🎮',
  '🎨',
  '🎵',
  '📚',
  '⚽',
  '🎬',
  '🌍',
  '⭐',
  '🚀',
  '🌟',
  '🍕',
  '☕',
  '🐱',
  '🐶',
  '🏆',
  '🎯',
  '🛠️',
  '📷',
  '💡',
  '🌱',
  '🔥',
  '💜',
  '🧩',
  '🎲',
  '🚲',
  '🏕️',
  '🍀',
  '🦊',
];

function EmojiSelect({
  name,
  selected,
  label,
  used,
}: Readonly<{
  name: string;
  selected: string;
  label: string;
  used: ReadonlySet<string | null>;
}>) {
  const options = emojis.includes(selected) ? emojis : [selected, ...emojis];

  return (
    <select name={name} aria-label={label} class="role-emoji">
      {options
        .filter((emoji) => emoji === selected || !used.has(emoji))
        .map((emoji) => (
          <option key={emoji} value={emoji} selected={emoji === selected}>
            {emoji}
          </option>
        ))}
    </select>
  );
}

function panelChoices(form: FormData, remove: string | undefined) {
  const choices = [];

  for (let index = 0; index < 20; index++) {
    const roleId = field(form, `role-${index}`);
    const emoji = field(form, `emoji-${index}`);

    if (roleId !== undefined && roleId !== remove) {
      if (emoji === undefined) {
        throw new UserError('Choose a reaction for each role.');
      }

      choices.push({ roleId, emoji });
    }
  }

  return choices;
}

export function rolePages({ services }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const panels = await services.roles.list(c.var.actor);
      const channelId =
        c.req.query('channel') ??
        panels[0]?.channelId ??
        c.var.server.channels[0]?.id;
      const panel = panels.find((p) => p.channelId === channelId);
      const entries = panel?.roles ?? [];
      const selected = new Set(entries.map((entry) => entry.roleId));
      const used = new Set(entries.map((entry) => entry.emoji));
      const assignable = c.var.server.roles.filter(
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
        <Layout
          title="Self-selection roles"
          path="/roles"
          can={c.var.can}
          flash={flashOf(c)}
        >
          <p>
            Members react in Discord to get a role. Removing their reaction
            removes the role.
          </p>
          <form method="get" action="/roles" class="role-channel">
            <ChannelSelect
              server={c.var.server}
              name="channel"
              selected={channelId}
            />
            <button type="submit" class="secondary">
              Open channel
            </button>
          </form>
          {channelId !== undefined ? (
            <form method="post" action="/roles">
              <input type="hidden" name="channelId" value={channelId} />
              <h2>{c.var.server.channelName(channelId)}</h2>
              <p hidden={unavailable.length === 0}>
                Unavailable roles:{' '}
                {unavailable.map((entry) => entry.label).join(', ')}.{' '}
                <button
                  type="submit"
                  name="remove"
                  value="unavailable"
                  class="secondary"
                  disabled={unavailable.length === 0}
                  formNoValidate
                >
                  Remove unavailable roles
                </button>
              </p>
              {panel !== undefined && panel.messageId !== null ? (
                <p>
                  <a
                    href={`https://discord.com/channels/${c.var.actor.guildId}/${channelId}/${panel.messageId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View panel in Discord ↗
                  </a>
                </p>
              ) : null}
              {entries.length === 0 ? (
                <p>
                  No roles yet. Add your first role below to create the panel.
                </p>
              ) : (
                <>
                  <div class="role-choices">
                    {entries.map((entry, index) => (
                      <div class="role-choice" key={entry.roleId}>
                        <input
                          type="hidden"
                          name={`role-${index}`}
                          value={entry.roleId}
                        />
                        <EmojiSelect
                          name={`emoji-${index}`}
                          selected={entry.emoji ?? nextEmoji}
                          label={`Emoji for ${entry.label}`}
                          used={used}
                        />
                        <strong>{entry.label}</strong>
                        <button
                          type="submit"
                          name="remove"
                          value={entry.roleId}
                          class="secondary outline"
                          aria-label={`Remove ${entry.label}`}
                          formNoValidate
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="submit">Save reaction panel</button>
                </>
              )}
              {entries.length < 20 && available.length > 0 ? (
                <fieldset class="role-add">
                  <legend>Add a role</legend>
                  <div class="role-add-fields">
                    <Select label="Role" name="new-role">
                      <option value="">Choose a role…</option>
                      {available.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </Select>
                    <label>
                      Reaction
                      <EmojiSelect
                        name="new-emoji"
                        selected={nextEmoji}
                        label="Reaction for new role"
                        used={used}
                      />
                    </label>
                    <button type="submit" name="action" value="add">
                      Add role
                    </button>
                  </div>
                </fieldset>
              ) : (
                <p>
                  {entries.length >= 20
                    ? 'This panel has the maximum of 20 roles.'
                    : 'All available roles are already on this panel.'}
                </p>
              )}
              <details>
                <summary>Bot permissions</summary>
                <p>
                  The bot needs Manage Roles and must be above these roles. To
                  remove old reactions, it also needs Manage Messages in this
                  channel. Removing a choice keeps roles already held by
                  members.
                </p>
              </details>
            </form>
          ) : (
            <p>There are no available channels.</p>
          )}
        </Layout>,
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

      const assignableIds = new Set(
        c.var.server.roles
          .filter((role) => selfAssignProblem(role) === undefined)
          .map((role) => role.id),
      );
      const wanted =
        remove === 'unavailable'
          ? choices.filter((choice) => assignableIds.has(choice.roleId))
          : choices;

      await services.roles.save(c.var.actor, channelId, wanted);

      return back(c, `/roles?channel=${encodeURIComponent(channelId)}`, {
        notice:
          remove !== undefined
            ? 'Role removed from the panel.'
            : 'Reaction panel saved.',
      });
    });
}
