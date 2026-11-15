import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import type { AppContext } from '~/infra/discord';
import { render } from '~/features/announcements';
import type { Announcement } from '~/features/announcements/schema';
import {
  getAnnouncement,
  insertAnnouncement,
  transition,
} from '~/features/announcements/service';

const draft = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: 1,
  guildId: 'g',
  authorId: 'a',
  channelId: 'c',
  title: 'Hello',
  content: 'World',
  embed: false,
  mentionRoleId: null,
  status: 'draft',
  scheduledAt: null,
  publishedAt: null,
  messageId: null,
  failure: null,
  createdAt: new Date(),
  ...overrides,
});

describe('announcement rendering', () => {
  it('never parses mentions written into the text', () => {
    expect(render(draft({ content: '@everyone hi' })).allowedMentions).toEqual({
      parse: [],
    });
  });

  it('only allows the chosen role or @everyone', () => {
    expect(render(draft({ mentionRoleId: 'r' })).allowedMentions).toEqual({
      roles: ['r'],
    });
    expect(render(draft({ mentionRoleId: 'g' })).allowedMentions).toEqual({
      parse: ['everyone'],
    });
  });

  it('rejects plain messages over the Discord limit', () => {
    expect(() => render(draft({ content: 'x'.repeat(2001) }))).toThrow('2000');
    expect(() =>
      render(draft({ content: 'x'.repeat(2001), embed: true })),
    ).not.toThrow();
  });
});

const input = () => ({
  guildId: snowflake(),
  authorId: 'a',
  channelId: 'c',
  title: 'Hello',
  content: 'World',
  embed: false,
  mentionRoleId: null,
});

describe.skipIf(noDatabase)('announcement publishing', () => {
  it('lets only one concurrent publish claim a draft', async () => {
    const db = testDb();
    const row = await insertAnnouncement(db, input());
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        transition(db, row.id, ['draft'], { status: 'publishing' }),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('skips scheduled announcements that are long overdue', async () => {
    const db = testDb();
    const { announcementsFeature } = await import('~/features/announcements');
    const job = announcementsFeature.jobs?.[0];
    const send = vi.fn();
    const ctx = {
      db,
      log: pino({ level: 'silent' }),
      client: {
        channels: { fetch: async () => ({ isSendable: () => true, send }) },
      },
    } as unknown as AppContext;
    const row = await insertAnnouncement(db, input());

    await transition(db, row.id, ['draft'], {
      status: 'scheduled',
      scheduledAt: new Date(Date.now() - 2 * 3_600_000),
    });
    await job?.run(
      { announcementId: row.id },
      { id: 1, runAt: new Date(), attempt: 1 },
      ctx,
    );
    expect(send).not.toHaveBeenCalled();
    expect((await getAnnouncement(db, row.id))?.status).toBe('failed');
  });

  it('publishes due scheduled announcements once', async () => {
    const db = testDb();
    const { announcementsFeature } = await import('~/features/announcements');
    const job = announcementsFeature.jobs?.[0];
    const send = vi.fn(async () => ({ id: 'm1' }));
    const ctx = {
      db,
      log: pino({ level: 'silent' }),
      client: {
        channels: { fetch: async () => ({ isSendable: () => true, send }) },
      },
    } as unknown as AppContext;
    const row = await insertAnnouncement(db, input());

    await transition(db, row.id, ['draft'], {
      status: 'scheduled',
      scheduledAt: new Date(),
    });
    const info = { id: 1, runAt: new Date(), attempt: 1 };

    await job?.run({ announcementId: row.id }, info, ctx);
    await job?.run({ announcementId: row.id }, info, ctx);
    expect(send).toHaveBeenCalledOnce();
    expect(await getAnnouncement(db, row.id)).toMatchObject({
      status: 'published',
      messageId: 'm1',
    });
  });
});
