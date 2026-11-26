import { Hono } from 'hono';
import {
  back,
  field,
  flashOf,
  formatter,
  mentionsFrom,
  type Env,
  type WebDeps,
} from '~/web/context';
import { ReminderPage } from './index';

export function reminderRoutes({ services, timezone }: WebDeps) {
  const date = formatter(timezone);
  const { reminders } = services;

  return new Hono<Env>()
    .get('/', async (c) =>
      c.html(
        <ReminderPage
          reminders={await reminders.list(c.var.actor)}
          server={await c.var.server(true)}
          date={date}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      ),
    )
    .post('/', async (c) => {
      const form = await c.req.formData();
      const when = field(form, 'when');
      const channelId = field(form, 'channelId');
      const repeat = field(form, 'repeat');
      const reminder = await reminders.create(c.var.actor, {
        message: field(form, 'message') ?? '',
        ...(when !== undefined && { when }),
        ...(channelId !== undefined && {
          channelId,
          mentions: mentionsFrom(form),
        }),
        ...(repeat !== undefined && { repeat }),
      });

      return back(c, '/reminders', {
        notice: `Reminder set for ${date(reminder.runAt)}.`,
      });
    })
    .post(String.raw`/:id{\d+}`, async (c) => {
      const form = await c.req.formData();
      const when = field(form, 'when');
      const message = field(form, 'message');
      const updated = await reminders.edit(
        c.var.actor,
        Number(c.req.param('id')),
        {
          ...(when !== undefined && { when }),
          ...(message !== undefined && { message }),
        },
      );

      return back(c, '/reminders', {
        notice: `Reminder updated for ${date(updated.runAt)}.`,
      });
    })
    .post(String.raw`/:id{\d+}/cancel`, async (c) => {
      await reminders.cancel(c.var.actor, Number(c.req.param('id')));

      return back(c, '/reminders', { notice: 'Reminder cancelled.' });
    });
}
