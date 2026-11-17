import type { Permission } from '~/core/permission';
import type { LogEntry } from '~/integrations/logging/store';
import { logPageSize } from '~/integrations/logging/store';
import { Layout } from '~/web/layout';
import { LogEntries } from './entries';
import { LogFilters } from './filter-form';

interface Props {
  readonly entries: LogEntry[];
  readonly hasMore: boolean;
  readonly live: boolean;
  readonly date: Intl.DateTimeFormat;
  readonly toggle: URLSearchParams;
  readonly older: URLSearchParams;
  readonly latest: URLSearchParams;
  readonly minimum: { name: string; value: number };
  readonly query: string;
  readonly before: number | undefined;
  readonly timezone: string;
  readonly can: ReadonlySet<Permission>;
}

export function LogPage({
  entries,
  hasMore,
  live,
  date,
  toggle,
  older,
  latest,
  minimum,
  query,
  before,
  timezone,
  can,
}: Props) {
  return (
    <Layout
      title="Logs"
      path="/settings/logs"
      can={can}
      actions={
        <a
          href={`/settings/logs?${toggle.toString()}`}
          class="secondary outline"
        >
          {live ? 'Pause refresh' : 'Resume refresh'}
        </a>
      }
    >
      <p>
        All saved logs, newest first. Showing up to {logPageSize} entries per
        page.
      </p>
      <LogFilters live={live} minimum={minimum} query={query} />
      <p>
        <small>
          {entries.length} matching entries ·{' '}
          {live ? 'Updates every 10 seconds' : 'Refresh paused'}. Only entries
          enabled by LOG_LEVEL appear.
        </small>
      </p>
      <nav aria-label="Log history">
        <ul>
          <li>
            {before === undefined ? null : (
              <a href={`/settings/logs?${latest.toString()}`}>Latest entries</a>
            )}
          </li>
        </ul>
        <ul>
          <li>
            {hasMore ? (
              <a href={`/settings/logs?${older.toString()}`}>Older entries</a>
            ) : null}
          </li>
        </ul>
      </nav>
      {entries.length === 0 ? (
        <p>No matching log entries.</p>
      ) : (
        <LogEntries entries={entries} date={date} timezone={timezone} />
      )}
    </Layout>
  );
}
