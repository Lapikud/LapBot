import type { Message } from '~/core/message';
import type { Server } from '~/web/context';

const token = /(<@&\d+>|<@\d+>|<#\d+>|\*\*[^*]+\*\*)/;

function withOffsets(parts: readonly string[], separator = 0) {
  let offset = 0;

  return parts.map((part) => {
    const start = offset;

    offset += part.length + separator;

    return { part, start };
  });
}

function Piece({ part, server }: Readonly<{ part: string; server: Server }>) {
  const role = /^<@&(\d+)>$/.exec(part)?.[1];
  const channel = /^<#(\d+)>$/.exec(part)?.[1];

  if (role !== undefined) {
    return <span class="mention">@{server.roleName(role)}</span>;
  }

  const user = /^<@(\d+)>$/.exec(part)?.[1];

  if (user !== undefined) {
    return (
      <span class="mention">
        @{server.members.find(({ id }) => id === user)?.name ?? 'user'}
      </span>
    );
  }

  if (channel !== undefined) {
    return <span class="mention">#{server.channelName(channel)}</span>;
  }

  if (part.startsWith('**') && part.endsWith('**')) {
    return <strong>{part.slice(2, -2)}</strong>;
  }

  return <span>{part}</span>;
}

function Line({ text, server }: Readonly<{ text: string; server: Server }>) {
  const prefix = /^(# |-# )/.exec(text)?.[0] ?? '';
  const pieces = withOffsets(
    text
      .slice(prefix.length)
      .split(token)
      .filter((part) => part !== ''),
  ).map(({ part, start }) => <Piece key={start} part={part} server={server} />);

  if (prefix === '# ') {
    return <div class="h1">{pieces}</div>;
  }

  return prefix === '' ? <div>{pieces}</div> : <small>{pieces}</small>;
}

export function MessagePreview({
  message,
  server,
}: Readonly<{ message: Message; server: Server }>) {
  const lines = withOffsets((message.content ?? '').split('\n'), 1);

  return (
    <div class="discord">
      {lines.map(({ part, start }) => (
        <Line key={start} text={part} server={server} />
      ))}
    </div>
  );
}
