import type { Message } from '~/domain';
import type { Guild } from './context';

const token = /(<@&\d+>|<@\d+>|<#\d+>|@everyone|\*\*[^*]+\*\*)/;

function Inline(props: Readonly<{ text: string; guild: Guild }>) {
  return (
    <>
      {props.text.split(token).map((part) => {
        const role = /^<@&(\d+)>$/.exec(part)?.[1];
        const channel = /^<#(\d+)>$/.exec(part)?.[1];

        if (role !== undefined) {
          return <span class="mention">@{props.guild.roleName(role)}</span>;
        }

        if (/^<@\d+>$/.test(part)) {
          return <span class="mention">@user</span>;
        }

        if (channel !== undefined) {
          return (
            <span class="mention">#{props.guild.channelName(channel)}</span>
          );
        }

        if (part === '@everyone') {
          return <span class="mention">@everyone</span>;
        }

        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong>{part.slice(2, -2)}</strong>;
        }

        return <>{part}</>;
      })}
    </>
  );
}

export function MessagePreview(
  props: Readonly<{ message: Message; guild: Guild }>,
) {
  const lines = (props.message.content ?? '').split('\n');

  return (
    <div class="discord">
      {lines.map((line) =>
        line.startsWith('# ') ? (
          <div class="h1">
            <Inline text={line.slice(2)} guild={props.guild} />
          </div>
        ) : (
          <div>
            <Inline text={line} guild={props.guild} />
          </div>
        ),
      )}
    </div>
  );
}
