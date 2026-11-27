import { ChannelOptions } from '~/web/components/selectors';
import type { Server } from '~/web/context';

interface Props {
  server: Server;
  channelId: string | undefined;
}
export function RoleChannelPicker({ server, channelId }: Readonly<Props>) {
  return (
    <form method="get" action="/settings/roles">
      <label htmlFor="channel">Panel channel</label>
      <fieldset role="group">
        <select id="channel" name="channel" required>
          <ChannelOptions
            server={server}
            {...(channelId !== undefined && { selected: channelId })}
          />
        </select>
        <button type="submit" class="secondary">
          Open
        </button>
      </fieldset>
    </form>
  );
}
