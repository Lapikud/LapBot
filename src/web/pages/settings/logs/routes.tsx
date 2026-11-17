import { Hono } from 'hono';
import { type LogStore } from '~/integrations/logging/store';
import type { Env } from '~/web/context';
import { levels, logCursor } from './filters';
import { LogPage } from './index';
import { LogsUnavailablePage } from './unavailable';

export function logRoutes(timezone: string, logs: LogStore) {
  const date = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: timezone,
  });

  return new Hono<Env>().get('/', (c) => {
    c.header('Cache-Control', 'no-store');

    if (!c.var.actor.administrator) {
      return c.html(<LogsUnavailablePage can={c.var.can} />, 403);
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
      <LogPage
        entries={entries}
        hasMore={hasMore}
        live={live}
        date={date}
        toggle={toggle}
        older={older}
        latest={latest}
        minimum={minimum}
        query={query}
        before={before}
        timezone={timezone}
        can={c.var.can}
      />,
    );
  });
}
