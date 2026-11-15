import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import type { AppContext } from '~/core/feature';
import { PermanentError, UserError } from '~/shared/errors';
import { createReminder, deliverJob } from '~/features/reminders';
import {
  getReminder,
  insertReminder,
  maxActivePerUser,
} from '~/features/reminders/service';

const cannotDm = new DiscordAPIError(
  {
    code: RESTJSONErrorCodes.CannotSendMessagesToThisUser,
    message: 'Cannot send messages to this user',
  },
  RESTJSONErrorCodes.CannotSendMessagesToThisUser,
  403,
  'POST',
  '/channels/x/messages',
  {},
);

function context() {
  const send = vi.fn(async () => undefined);
  const schedule = vi.fn(async () => undefined);
  const ctx = {
    db: noDatabase ? undefined : testDb(),
    log: pino({ level: 'silent' }),
    client: { users: { fetch: async () => ({ send }) } },
    scheduler: { schedule, cancel: vi.fn() },
  } as unknown as AppContext;

  return { ctx, send, schedule };
}

const info = { id: 1, runAt: new Date(), attempt: 1 };
const base = () => ({
  guildId: snowflake(),
  userId: snowflake(),
  channelId: null,
  message: 'stand-up',
  runAt: new Date(Date.now() + 60_000),
  recurrence: null,
  timezone: 'Europe/Tallinn',
});

describe.skipIf(noDatabase)('reminders', () => {
  it('schedules a job keyed to the reminder', async () => {
    const { ctx, schedule } = context();
    const reminder = await createReminder(ctx, base());

    expect(schedule).toHaveBeenCalledWith(
      deliverJob,
      { reminderId: reminder.id },
      {
        runAt: reminder.runAt,
        key: `reminder:${reminder.id}`,
      },
    );
  });

  it('delivers one-off reminders by DM and completes them', async () => {
    const { ctx, send } = context();
    const reminder = await insertReminder(ctx.db, base());

    expect(
      await deliverJob.run({ reminderId: reminder.id }, info, ctx),
    ).toBeNull();
    expect(send).toHaveBeenCalledWith({ content: '⏰ **Reminder:** stand-up' });
    expect((await getReminder(ctx.db, reminder.id))?.status).toBe('done');
  });

  it('reschedules recurring reminders into the future', async () => {
    const { ctx } = context();
    const reminder = await insertReminder(ctx.db, {
      ...base(),
      runAt: new Date(Date.now() - 3 * 86_400_000),
      recurrence: 'daily',
    });
    const outcome = await deliverJob.run(
      { reminderId: reminder.id },
      info,
      ctx,
    );

    expect(outcome?.rescheduleAt.getTime()).toBeGreaterThan(Date.now());
    expect(outcome?.rescheduleAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 86_400_000,
    );
    expect((await getReminder(ctx.db, reminder.id))?.status).toBe('active');
  });

  it('fails permanently when DMs are closed', async () => {
    const { ctx, send } = context();

    send.mockRejectedValue(cannotDm);
    const reminder = await insertReminder(ctx.db, base());

    await expect(
      deliverJob.run({ reminderId: reminder.id }, info, ctx),
    ).rejects.toBeInstanceOf(PermanentError);
    expect((await getReminder(ctx.db, reminder.id))?.status).toBe('failed');
  });

  it('skips cancelled reminders', async () => {
    const { ctx, send } = context();
    const reminder = await insertReminder(ctx.db, base());
    const { updateReminder } = await import('~/features/reminders/service');

    await updateReminder(ctx.db, reminder.id, { status: 'cancelled' });
    await deliverJob.run({ reminderId: reminder.id }, info, ctx);
    expect(send).not.toHaveBeenCalled();
  });

  it('limits active reminders per user and message length', async () => {
    const { ctx } = context();
    const input = base();

    for (let n = 0; n < maxActivePerUser; n++) {
      await insertReminder(ctx.db, input);
    }

    await expect(insertReminder(ctx.db, input)).rejects.toBeInstanceOf(
      UserError,
    );
    await expect(
      insertReminder(ctx.db, { ...base(), message: 'x'.repeat(1001) }),
    ).rejects.toThrow('at most');
  });
});
