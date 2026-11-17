import type { RoleInfo } from '~/core/ports/directory';
import type { PanelRole, RolePanel } from '~/features/roles/model';
import { Select } from '~/web/components/controls';
import type { Server } from '~/web/context';
import { EmojiSelect } from './emoji-select';

interface Props {
  readonly channelId: string;
  readonly server: Server;
  readonly guildId: string;
  readonly unavailable: PanelRole[];
  readonly panel: RolePanel | undefined;
  readonly entries: PanelRole[];
  readonly available: RoleInfo[];
  readonly nextEmoji: string;
  readonly used: ReadonlySet<string | null>;
}
export function RolePanelForm({
  channelId,
  server,
  guildId,
  unavailable,
  panel,
  entries,
  available,
  nextEmoji,
  used,
}: Props) {
  return (
    <form method="post" action="/roles">
      <input type="hidden" name="channelId" value={channelId} />
      <h2>{server.channelName(channelId)}</h2>
      <p hidden={unavailable.length === 0}>
        Unavailable roles: {unavailable.map((entry) => entry.label).join(', ')}.{' '}
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
            href={`https://discord.com/channels/${guildId}/${channelId}/${panel.messageId}`}
            target="_blank"
            rel="noreferrer"
          >
            View panel in Discord ↗
          </a>
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p>No roles yet. Add your first role below to create the panel.</p>
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
            <label htmlFor="new-emoji">
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
          The bot needs Manage Roles and must be above these roles. To remove
          old reactions, it also needs Manage Messages in this channel. Removing
          a choice keeps roles already held by members.
        </p>
      </details>
    </form>
  );
}
