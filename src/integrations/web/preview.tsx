import type { Message } from '~/foundation/message';
import type { Server } from './context';

const token = /(<@&\d+>|<@\d+>|<#\d+>|@everyone|\*\*[^*]+\*\*)/;

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

  if (/^<@\d+>$/.test(part)) {
    return <span class="mention">@user</span>;
  }

  if (channel !== undefined) {
    return <span class="mention">#{server.channelName(channel)}</span>;
  }

  if (part === '@everyone') {
    return <span class="mention">@everyone</span>;
  }

  if (part.startsWith('**') && part.endsWith('**')) {
    return <strong>{part.slice(2, -2)}</strong>;
  }

  return <span>{part}</span>;
}

function Line({ text, server }: Readonly<{ text: string; server: Server }>) {
  const heading = text.startsWith('# ');
  const body = heading ? text.slice(2) : text;
  const pieces = withOffsets(
    body.split(token).filter((part) => part !== ''),
  ).map(({ part, start }) => <Piece key={start} part={part} server={server} />);

  return heading ? <div class="h1">{pieces}</div> : <div>{pieces}</div>;
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
