import { Hono } from 'hono';
import { visibleRecords } from '~/core/helpers/visibility';
import type { Env, WebDeps } from '~/web/context';
import { HelpPage } from './index';

export function helpRoutes({ services, directory, guildId }: WebDeps) {
  return new Hono<Env>().get('/', async (c) => {
    const [announcements, events, polls] = await Promise.all([
      services.announcements.list(c.var.actor),
      services.events.upcoming(guildId),
      services.polls.open(guildId),
    ]);
    const [visibleEvents, visiblePolls] = await Promise.all([
      visibleRecords(directory, c.var.actor, events),
      visibleRecords(directory, c.var.actor, polls),
    ]);
    const pending = announcements.filter(
      (a) => a.status === 'scheduled' || a.status === 'draft',
    );

    return c.html(
      <HelpPage
        can={c.var.can}
        now={{
          pending: pending.length,
          events: visibleEvents.length,
          polls: visiblePolls.length,
        }}
      />,
    );
  });
}
