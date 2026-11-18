import { Hono } from 'hono';
import { type LogStore } from '~/integrations/logging/store';
import type { Env } from '~/web/context';
import { levels, logPageNumber } from './filters';
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
    const { entries, total, page, pages } = logs.page({
      level: minimum.value,
      query,
      page: logPageNumber(c.req.query('page')),
    });
    const live = c.req.query('live') !== '0' && page === 1;
    const filters = { level: minimum.name, q: query };
    const toggle = new URLSearchParams({ ...filters, live: live ? '0' : '1' });
    const pageLink = (number: number) =>
      new URLSearchParams({ ...filters, page: String(number), live: '0' });
    const latest = new URLSearchParams({ ...filters, live: '1' });

    if (live) {
      c.header('Refresh', '10');
    }

    return c.html(
      <LogPage
        entries={entries}
        page={page}
        pages={pages}
        total={total}
        live={live}
        date={date}
        toggle={toggle}
        pageLink={pageLink}
        latest={latest}
        minimum={minimum}
        query={query}
        timezone={timezone}
        can={c.var.can}
      />,
    );
  });
}
