import type { Permission } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';
import type { PanelRole, RolePanel } from '~/features/roles/model';
import type { Flash, Server } from '~/web/context';
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
    <Layout title="Roles" path="/roles" can={can} flash={flash}>
      <p>
        Members react in Discord to get a role. Removing their reaction removes
        the role.
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
    </Layout>
  );
}
