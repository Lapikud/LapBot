import { describe, expect, it, vi } from 'vitest';
import type { Scheduler } from '~/core/ports';
import { createReminderService } from '~/core/reminders';
import { PermanentError, UserError } from '~/domain';
import { createReminderRepository, maxActivePerUser } from '~/infra/db';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  allowAll,
  denyAll,
  fakeDirectory,
  fakeMessenger,
} from '../../fakes';

describe.skipIf(noDatabase)('reminder service', () => {
  const setup = (authz = allowAll) => {
    const { messenger } = fakeMessenger();
    const scheduler = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
    };
    const repository = createReminderRepository(testDb());
    const service = createReminderService({
      reminders: repository,
      scheduler,
      messenger,
      directory: fakeDirectory(),
      authz,
      timezone: 'Europe/Tallinn',
    });
    const [deliver] = service.jobs;

    return {
      service,
      messenger,
      scheduler,
      repository,
      deliver,
      member: actor({ guildId: snowflake(), userId: snowflake() }),
    };
  };

  it('schedules a job keyed to the reminder', async () => {
    const { service, scheduler, member } = setup();
    const reminder = await service.create(member, {
      when: '10m',
      message: 'stand-up',
    });

    expect(scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reminders.deliver' }),
      { reminderId: reminder.id },
      {
        runAt: reminder.runAt,
        key: `reminder:${reminder.id}`,
      },
    );
  });

  it('reminds a day later when no time is given', async () => {
    const { service, member } = setup();
    const before = Date.now();
    const reminder = await service.create(member, { message: 'read this' });
    const offset = reminder.runAt.getTime() - before;

    expect(offset).toBeGreaterThanOrEqual(86_400_000 - 1000);
    expect(offset).toBeLessThanOrEqual(86_400_000 + 5000);
  });

  it('delivers one-off reminders by DM and completes them', async () => {
    const { service, messenger, repository, deliver, member } = setup();
    const reminder = await service.create(member, {
      when: '10m',
      message: 'stand-up',
    });

    expect(await deliver?.run({ reminderId: reminder.id })).toBeNull();
    expect(messenger.direct).toHaveBeenCalledWith(member.userId, {
      content: '⏰ **Reminder:** stand-up',
    });
    expect((await repository.find(reminder.id))?.status).toBe('done');
  });

  it('reschedules recurring reminders into the future', async () => {
    const { service, repository, deliver, member } = setup();
    const reminder = await service.schedule({
      guildId: member.guildId,
      userId: member.userId,
      channelId: null,
      message: 'daily',
      runAt: new Date(Date.now() - 3 * 86_400_000),
      recurrence: 'daily',
      timezone: 'Europe/Tallinn',
    });
    const outcome = await deliver?.run({ reminderId: reminder.id });

    expect(outcome?.rescheduleAt.getTime()).toBeGreaterThan(Date.now());
    expect(outcome?.rescheduleAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 86_400_000,
    );
    expect((await repository.find(reminder.id))?.status).toBe('active');
  });

  it('fails permanently when DMs are closed', async () => {
    const { service, messenger, repository, deliver, member } = setup();

    messenger.direct.mockRejectedValue(
      new PermanentError('Cannot send messages to this user'),
    );

    const reminder = await service.create(member, {
      when: '10m',
      message: 'x',
    });

    await expect(
      deliver?.run({ reminderId: reminder.id }),
    ).rejects.toBeInstanceOf(PermanentError);
    expect((await repository.find(reminder.id))?.status).toBe('failed');
  });

  it('skips cancelled reminders and only lets owners manage them', async () => {
    const { service, messenger, deliver, member } = setup();
    const reminder = await service.create(member, {
      when: '10m',
      message: 'x',
    });

    await expect(
      service.cancel(actor({ guildId: member.guildId }), reminder.id),
    ).rejects.toBeInstanceOf(UserError);
    await service.cancel(member, reminder.id);
    await deliver?.run({ reminderId: reminder.id });
    expect(messenger.direct).not.toHaveBeenCalled();
  });

  it('requires permission for channel reminders', async () => {
    const { service, member } = setup(denyAll);

    await expect(
      service.create(member, { when: '10m', message: 'x', channelId: 'c' }),
    ).rejects.toThrow('denied');
  });

  it('limits active reminders per user and message length', async () => {
    const { service, member } = setup();

    for (let n = 0; n < maxActivePerUser; n++) {
      await service.create(member, { when: '1h', message: 'x' });
    }

    await expect(
      service.create(member, { when: '1h', message: 'x' }),
    ).rejects.toBeInstanceOf(UserError);
    await expect(
      service.create(actor({ guildId: snowflake() }), {
        when: '1h',
        message: 'x'.repeat(1001),
      }),
    ).rejects.toThrow('at most');
  });
});
