import { ChannelSelect } from '~/web/components/selectors';
import type { Server } from '~/web/context';

interface Props {
  server: Server;
  channelId: string | undefined;
}
export function RoleChannelPicker({ server, channelId }: Readonly<Props>) {
  return (
    <form method="get" action="/settings/roles" class="role-channel">
      <ChannelSelect
        server={server}
        name="channel"
        {...(channelId !== undefined && { selected: channelId })}
      />
      <button type="submit" class="secondary">
        Open channel
      </button>
    </form>
  );
}
