import { describe, expect, it, vi } from 'vitest';
import { UserError } from '~/core/errors';
import type { Scheduler } from '~/core/ports/scheduler';
import { createReminderRepository } from '~/features/reminders/repository';
import { createReminderService } from '~/features/reminders/service';
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
});
