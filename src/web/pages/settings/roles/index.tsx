import type { Permission } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';
import type { PanelRole, RolePanel } from '~/features/roles/model';
import type { Flash, Server } from '~/web/context';
import { Confirm } from '~/web/components/actions';
import { Layout } from '~/web/layout';
import { RoleChannelPicker } from './channel-picker';
import { RolePanelForm } from './panel';

interface Props {
  channelId: string | undefined;
  unavailable: PanelRole[];
  panel: RolePanel | undefined;
  entries: PanelRole[];
  available: RoleInfo[];
  nextEmoji: string;
  used: ReadonlySet<string | null>;
  server: Server;
  guildId: string;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function RolePage({
  channelId,
  unavailable,
  panel,
  entries,
  available,
  nextEmoji,
  used,
  server,
  guildId,
  can,
  flash,
}: Readonly<Props>) {
  return (
    <Layout title="Role panels" path="/settings/roles" can={can} flash={flash}>
      <p>
        Members react in Discord to get a role. Removing their reaction removes
        the role.
      </p>
      <p>
        For a dropdown panel, or several panels in one channel,{' '}
        <a href="/forms">create a form</a> with a "Give roles" question and post
        it.
      </p>
      <RoleChannelPicker server={server} channelId={channelId} />
      {channelId !== undefined ? (
        <RolePanelForm
          channelId={channelId}
          server={server}
          guildId={guildId}
          unavailable={unavailable}
          panel={panel}
          entries={entries}
          available={available}
          nextEmoji={nextEmoji}
          used={used}
        />
      ) : (
        <p>There are no available channels.</p>
      )}
      {channelId !== undefined && panel !== undefined ? (
        <Confirm
          label="Delete panel"
          question="Delete this panel and its Discord message? Members keep the roles they already have."
        >
          <form method="post" action="/settings/roles/delete">
            <input type="hidden" name="channelId" value={channelId} />
            <button type="submit">Yes, delete panel</button>
          </form>
        </Confirm>
      ) : null}
    </Layout>
  );
}
