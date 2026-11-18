import type { Permission } from '~/core/permission';
import type { LogEntry } from '~/integrations/logging/store';
import { Layout } from '~/web/layout';
import { LogEntries } from './entries';
import { LogFilters } from './filter-form';

interface Props {
  entries: LogEntry[];
  page: number;
  pages: number;
  total: number;
  live: boolean;
  date: Intl.DateTimeFormat;
  toggle: URLSearchParams;
  pageLink: (page: number) => URLSearchParams;
  latest: URLSearchParams;
  minimum: { name: string; value: number };
  query: string;
  timezone: string;
  can: ReadonlySet<Permission>;
}

export function LogPage({
  entries,
  page,
  pages,
  total,
  live,
  date,
  toggle,
  pageLink,
  latest,
  minimum,
  query,
  timezone,
  can,
}: Readonly<Props>) {
  const pagination = (
    <nav class="log-pagination" aria-label="Log pages">
      <a href={`/settings/logs?${latest.toString()}`}>Latest</a>
      {page > 1 ? (
        <a href={`/settings/logs?${pageLink(page - 1).toString()}`} rel="prev">
          Previous
        </a>
      ) : (
        <span aria-disabled="true">Previous</span>
      )}
      <span>
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <a href={`/settings/logs?${pageLink(page + 1).toString()}`} rel="next">
          Next
        </a>
      ) : (
        <span aria-disabled="true">Next</span>
      )}
    </nav>
  );

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
      <section class="log-view">
        <LogFilters live={live} minimum={minimum} query={query} />
        <p>
          <small>
            {total} matching entries · Newest first ·{' '}
            {live ? 'Updates every 10 seconds' : 'Refresh paused'}. Only entries
            enabled by LOG_LEVEL appear.
          </small>
        </p>
        {pagination}
        {entries.length === 0 ? (
          <p>No matching log entries.</p>
        ) : (
          <LogEntries entries={entries} date={date} timezone={timezone} />
        )}
        {pagination}
      </section>
    </Layout>
  );
}
