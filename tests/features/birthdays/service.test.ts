import { describe, expect, it, vi } from 'vitest';
import type { Scheduler } from '~/core/scheduler';
import { createBirthdayService } from '~/features/birthdays/service';
import { calendarDay } from '~/core/time';
import { createBirthdayRepository } from '~/features/birthdays/repository';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  silentLog,
} from '../../fakes';

describe.skipIf(noDatabase)('birthdays', () => {
  const repository = () => createBirthdayRepository(testDb());
  const today = { year: 2027, month: 2, day: 28 };

  it('announces each birthday once per year and respects privacy', async () => {
    const birthdays = repository();
    const guildId = snowflake();
    const [pub, announce, priv, leap, other] = [
      snowflake(),
      snowflake(),
      snowflake(),
      snowflake(),
      snowflake(),
    ];

    await birthdays.set({
      guildId,
      userId: pub,
      month: 2,
      day: 28,
      visibility: 'public',
    });
    await birthdays.set({
      guildId,
      userId: announce,
      month: 2,
      day: 28,
      visibility: 'announce',
    });
    await birthdays.set({
      guildId,
      userId: priv,
      month: 2,
      day: 28,
      visibility: 'private',
    });
    await birthdays.set({
      guildId,
      userId: leap,
      month: 2,
      day: 29,
      visibility: 'public',
    });
    await birthdays.set({
      guildId,
      userId: other,
      month: 3,
      day: 1,
      visibility: 'public',
    });

    const claimed = await birthdays.claim(guildId, today);

    expect(claimed).toHaveLength(3);
    expect(claimed).toEqual(expect.arrayContaining([pub, announce, leap]));
    expect(await birthdays.claim(guildId, today)).toEqual([]);
    expect(
      await birthdays.claim(guildId, { ...today, year: 2028 }),
    ).toHaveLength(2);
  });

  it('can release a claim after a failed post', async () => {
    const birthdays = repository();
    const guildId = snowflake();
    const user = snowflake();

    await birthdays.set({
      guildId,
      userId: user,
      month: 2,
      day: 28,
      visibility: 'public',
    });
    await birthdays.claim(guildId, today);
    await birthdays.release(guildId, [user], today.year);
    expect(await birthdays.claim(guildId, today)).toEqual([user]);
  });

  it('lists only public birthdays, starting from today', async () => {
    const birthdays = repository();
    const guildId = snowflake();
    const [jan, jun, dec, hidden] = [
      snowflake(),
      snowflake(),
      snowflake(),
      snowflake(),
    ];

    await birthdays.set({
      guildId,
      userId: jan,
      month: 1,
      day: 5,
      visibility: 'public',
    });
    await birthdays.set({
      guildId,
      userId: jun,
      month: 6,
      day: 5,
      visibility: 'public',
    });
    await birthdays.set({
      guildId,
      userId: dec,
      month: 12,
      day: 5,
      visibility: 'public',
    });
    await birthdays.set({
      guildId,
      userId: hidden,
      month: 6,
      day: 6,
      visibility: 'announce',
    });

    const list = await birthdays.upcoming(guildId, {
      year: 2026,
      month: 6,
      day: 1,
    });

    expect(list.map((b) => b.userId)).toEqual([jun, dec, jan]);
  });

  it('posts one message per day and reschedules', async () => {
    const { messenger } = fakeMessenger();
    const scheduler = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
    };
    const service = createBirthdayService({
      birthdays: repository(),
      scheduler,
      messenger,
      directory: fakeDirectory(),
      authz: allowAll,
      log: silentLog,
      timezone: 'Europe/Tallinn',
    });
    const admin = actor({ guildId: snowflake(), userId: snowflake() });
    const now = calendarDay(new Date(), 'Europe/Tallinn');

    await service.set(admin, { day: now.day, month: now.month });
    await service.configure(admin, { channelId: 'c' });

    const [daily] = service.jobs;
    const outcome = await daily?.run({ guildId: admin.guildId });

    await daily?.run({ guildId: admin.guildId });
    expect(messenger.send).toHaveBeenCalledOnce();
    expect(messenger.send).toHaveBeenCalledWith(
      'c',
      expect.objectContaining({ mentions: { users: [admin.userId] } }),
    );
    expect(outcome?.rescheduleAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('hides non-public birthdays from other members', async () => {
    const service = createBirthdayService({
      birthdays: repository(),
      scheduler: {
        schedule: async () => undefined,
        cancel: async () => undefined,
      },
      messenger: fakeMessenger().messenger,
      directory: fakeDirectory(),
      authz: allowAll,
      log: silentLog,
      timezone: 'Europe/Tallinn',
    });
    const owner = actor({ guildId: snowflake(), userId: snowflake() });

    await service.set(owner, { day: 1, month: 5, visibility: 'announce' });
    expect(await service.view(owner, owner.userId)).toBeDefined();
    expect(
      await service.view(actor({ guildId: owner.guildId }), owner.userId),
    ).toBeUndefined();
  });
});
