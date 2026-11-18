import type { Server } from '~/web/context';
import { Select } from '~/web/components/controls';

export function ChannelOptions({
  server,
  selected,
}: Readonly<{ server: Server; selected?: string }>) {
  return (
    <>
      {server.channels.map(({ id, name }) => (
        <option key={id} value={id} selected={selected === id}>
          #{name}
        </option>
      ))}
    </>
  );
}

export function ChannelSelect({
  server,
  name = 'channelId',
  selected,
}: Readonly<{ server: Server; name?: string; selected?: string }>) {
  return (
    <Select name={name} label="Channel" required>
      <ChannelOptions
        server={server}
        {...(selected !== undefined && { selected })}
      />
    </Select>
  );
}
