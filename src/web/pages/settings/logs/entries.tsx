import type { LogEntry } from '~/integrations/logging/store';
import { levels } from './filters';

interface Props {
  entries: LogEntry[];
  date: Intl.DateTimeFormat;
  timezone: string;
}
export function LogEntries({ entries, date, timezone }: Readonly<Props>) {
  return (
    <div class="log-table" role="region" aria-label="Log entries" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>Time ({timezone})</th>
            <th>Level</th>
            <th>Source</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={`${entry.time}-${entry.message}`}>
              <td>
                <time dateTime={new Date(entry.time).toISOString()}>
                  {date.format(entry.time)}
                </time>
              </td>
              <td>
                <strong class={`log-level log-level-${entry.level}`}>
                  {levels.find((level) => level.value === entry.level)?.name ??
                    entry.level}
                </strong>
              </td>
              <td>
                <code>{entry.source}</code>
              </td>
              <td>
                <div class="log-message">{entry.message}</div>
                {entry.details === '{}' ? null : (
                  <details>
                    <summary>Details</summary>
                    <pre>{entry.details}</pre>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
