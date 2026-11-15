import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import type { AppContext } from '~/infra/discord';
import { calendarDay, nextDailyRun } from '~/domain';
import { dailyJob } from '~/features/birthdays';
import {
  celebratedOn,
  claimTodaysBirthdays,
  releaseClaims,
  saveSettings,
  setBirthday,
  upcomingBirthdays,
  validateDate,
} from '~/features/birthdays/service';

describe('birthday dates', () => {
  it('accepts 29 February and rejects impossible dates', () => {
    expect(() => validateDate(2, 29)).not.toThrow();
    expect(() => validateDate(2, 30)).toThrow('valid date');
    expect(() => validateDate(4, 31)).toThrow('valid date');
  });

  it('celebrates leap-day birthdays on 28 February in non-leap years', () => {
    expect(celebratedOn({ year: 2027, month: 2, day: 28 })).toEqual([
      { month: 2, day: 28 },
      { month: 2, day: 29 },
    ]);
    expect(celebratedOn({ year: 2028, month: 2, day: 28 })).toEqual([
      { month: 2, day: 28 },
    ]);
    expect(celebratedOn({ year: 2028, month: 2, day: 29 })).toEqual([
      { month: 2, day: 29 },
    ]);
  });

  it('computes the next announcement hour in the guild timezone', () => {
    const now = new Date('2026-06-01T10:00:00Z');

    expect(nextDailyRun('Europe/Tallinn', 9, now).toISOString()).toBe(
      '2026-06-02T06:00:00.000Z',
    );
    expect(nextDailyRun('Europe/Tallinn', 15, now).toISOString()).toBe(
      '2026-06-01T12:00:00.000Z',
    );
  });
});

describe.skipIf(noDatabase)('birthday announcements', () => {
  const today = { year: 2027, month: 2, day: 28 };

  it('announces each birthday once per year and respects privacy', async () => {
    const db = testDb();
    const guildId = snowflake();
    const [pub, announce, priv, leap, other] = [
      snowflake(),
      snowflake(),
      snowflake(),
      snowflake(),
      snowflake(),
    ];

    await setBirthday(db, {
      guildId,
      userId: pub,
      month: 2,
      day: 28,
      visibility: 'public',
    });
    await setBirthday(db, {
      guildId,
      userId: announce,
      month: 2,
      day: 28,
      visibility: 'announce',
    });
    await setBirthday(db, {
      guildId,
      userId: priv,
      month: 2,
      day: 28,
      visibility: 'private',
    });
    await setBirthday(db, {
      guildId,
      userId: leap,
      month: 2,
      day: 29,
      visibility: 'public',
    });
    await setBirthday(db, {
      guildId,
      userId: other,
      month: 3,
      day: 1,
      visibility: 'public',
    });

    const claimed = await claimTodaysBirthdays(db, guildId, today);

    expect(claimed).toHaveLength(3);
    expect(claimed).toEqual(expect.arrayContaining([pub, announce, leap]));
    expect(await claimTodaysBirthdays(db, guildId, today)).toEqual([]);
    expect(
      await claimTodaysBirthdays(db, guildId, {
        ...today,
        year: today.year + 1,
      }),
    ).toHaveLength(2);
  });

  it('can release a claim after a failed post', async () => {
    const db = testDb();
    const guildId = snowflake();
    const user = snowflake();

    await setBirthday(db, {
      guildId,
      userId: user,
      month: 2,
      day: 28,
      visibility: 'public',
    });
    await claimTodaysBirthdays(db, guildId, today);
    await releaseClaims(db, guildId, [user], today.year);
    expect(await claimTodaysBirthdays(db, guildId, today)).toEqual([user]);
  });

  it('lists only public birthdays, starting from today', async () => {
    const db = testDb();
    const guildId = snowflake();
    const [jan, jun, dec, hidden] = [
      snowflake(),
      snowflake(),
      snowflake(),
      snowflake(),
    ];

    await setBirthday(db, {
      guildId,
      userId: jan,
      month: 1,
      day: 5,
      visibility: 'public',
    });
    await setBirthday(db, {
      guildId,
      userId: jun,
      month: 6,
      day: 5,
      visibility: 'public',
    });
    await setBirthday(db, {
      guildId,
      userId: dec,
      month: 12,
      day: 5,
      visibility: 'public',
    });
    await setBirthday(db, {
      guildId,
      userId: hidden,
      month: 6,
      day: 6,
      visibility: 'announce',
    });
    const list = await upcomingBirthdays(db, guildId, {
      year: 2026,
      month: 6,
      day: 1,
    });

    expect(list.map((b) => b.userId)).toEqual([jun, dec, jan]);
  });

  it('posts one message and reschedules for the next day', async () => {
    const db = testDb();
    const guildId = snowflake();
    const user = snowflake();
    const now = calendarDay(new Date(), 'Europe/Tallinn');

    await setBirthday(db, {
      guildId,
      userId: user,
      month: now.month,
      day: now.day,
      visibility: 'public',
    });
    await saveSettings(db, {
      guildId,
      channelId: snowflake(),
      roleId: null,
      hour: 9,
    });
    const send = vi.fn(async () => undefined);
    const ctx = {
      db,
      log: pino({ level: 'silent' }),
      config: { DEFAULT_TIMEZONE: 'Europe/Tallinn' },
      client: {
        channels: { fetch: async () => ({ isSendable: () => true, send }) },
      },
    } as unknown as AppContext;
    const info = { id: 1, runAt: new Date(), attempt: 1 };
    const outcome = await dailyJob.run({ guildId }, info, ctx);

    await dailyJob.run({ guildId }, info, ctx);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ allowedMentions: { users: [user] } }),
    );
    expect(outcome?.rescheduleAt.getTime()).toBeGreaterThan(Date.now());
  });
});
