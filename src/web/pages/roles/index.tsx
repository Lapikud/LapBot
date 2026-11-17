import type { Permission } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';
import type { PanelRole, RolePanel } from '~/features/roles/model';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { RoleChannelPicker } from './channel-picker';
import { RolePanelForm } from './panel';

interface Props {
  readonly channelId: string | undefined;
  readonly unavailable: PanelRole[];
  readonly panel: RolePanel | undefined;
  readonly entries: PanelRole[];
  readonly available: RoleInfo[];
  readonly nextEmoji: string;
  readonly used: ReadonlySet<string | null>;
  readonly server: Server;
  readonly guildId: string;
  readonly can: ReadonlySet<Permission>;
  readonly flash: Flash;
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
}: Props) {
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
