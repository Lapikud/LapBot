import { Hono } from 'hono';
import { logPageSize, type LogStore } from '~/integrations/logging/store';
import type { Env } from '~/presentation/web/context';
import { Layout } from '~/presentation/web/layout';

const levels = [
  { name: 'trace', value: 10 },
  { name: 'debug', value: 20 },
  { name: 'info', value: 30 },
  { name: 'warn', value: 40 },
  { name: 'error', value: 50 },
  { name: 'fatal', value: 60 },
] as const;

function logCursor(value: string | undefined): number | undefined {
  const cursor = Number(value);

  return Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined;
}

export function logPages(timezone: string, logs: LogStore) {
  const date = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: timezone,
  });

  return new Hono<Env>().get('/', (c) => {
    c.header('Cache-Control', 'no-store');

    if (!c.var.actor.administrator) {
      return c.html(
        <Layout can={c.var.can} title="Logs" path="/settings/logs">
          <p>Only server administrators can view logs.</p>
        </Layout>,
        403,
      );
    }

    const minimum =
      levels.find((level) => level.name === c.req.query('level')) ?? levels[0];
    const query = (c.req.query('q') ?? '').slice(0, 200);
    const before = logCursor(c.req.query('before'));
    const live = c.req.query('live') !== '0' && before === undefined;
    const { entries, hasMore } = logs.page({
      level: minimum.value,
      query,
      before,
    });
    const filters = { level: minimum.name, q: query };
    const toggle = new URLSearchParams({ ...filters, live: live ? '0' : '1' });
    const older = new URLSearchParams({
      ...filters,
      before: String(entries.at(-1)?.id ?? 0),
      live: '0',
    });
    const latest = new URLSearchParams({ ...filters, live: '1' });

    if (live) {
      c.header('Refresh', '10');
    }

    return c.html(
      <Layout
        title="Logs"
        path="/settings/logs"
        can={c.var.can}
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
        <form method="get" action="/settings/logs">
          <input type="hidden" name="live" value={live ? '1' : '0'} />
          <div class="grid">
            <label>
              Minimum level
              <select name="level">
                {levels.map((level) => (
                  <option
                    key={level.name}
                    value={level.name}
                    selected={minimum.name === level.name}
                  >
                    {level.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Search
              <input
                type="search"
                name="q"
                value={query}
                maxlength={200}
                placeholder="Message, source or details"
              />
            </label>
          </div>
          <button type="submit" class="secondary">
            Apply filters
          </button>
        </form>
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
                <a href={`/settings/logs?${latest.toString()}`}>
                  Latest entries
                </a>
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
          <div class="log-table">
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
                        {levels.find((level) => level.value === entry.level)
                          ?.name ?? entry.level}
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
        )}
      </Layout>,
    );
  });
}
