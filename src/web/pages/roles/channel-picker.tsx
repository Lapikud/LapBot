import { ChannelSelect } from '~/web/components/selectors';
import type { Server } from '~/web/context';

interface Props {
  readonly server: Server;
  readonly channelId: string | undefined;
}
export function RoleChannelPicker({ server, channelId }: Props) {
  return (
    <form method="get" action="/roles" class="role-channel">
      <ChannelSelect server={server} name="channel" selected={channelId} />
      <button type="submit" class="secondary">
        Open channel
      </button>
    </form>
  );
}
