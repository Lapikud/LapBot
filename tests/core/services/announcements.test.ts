import { describe, expect, it, vi } from 'vitest';
import type { Announcement, Scheduler } from '~/core/ports';
import { announcementView, createAnnouncementService } from '~/core/services';
import { createAnnouncementRepository } from '~/infra/db';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from '../../fakes';

const sample = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: 1,
  guildId: 'g',
  authorId: 'a',
  channelId: 'c',
  title: 'Hello',
  content: 'World',
  mentionRoleIds: [],
  mentionEveryone: false,
  status: 'draft',
  scheduledAt: null,
  publishedAt: null,
  messageId: null,
  failure: null,
  createdAt: new Date(),
  ...overrides,
});

describe('announcement view', () => {
  it('only pings the chosen roles or everyone, never text in the body', () => {
    expect(
      announcementView(sample({ content: '@everyone hi' })).mentions,
    ).toEqual({ everyone: false, roles: [] });
    expect(
      announcementView(sample({ mentionRoleIds: ['r1', 'r2'] })),
    ).toMatchObject({
      content: '<@&r1> <@&r2>\n# Hello\nWorld',
      mentions: { roles: ['r1', 'r2'] },
    });
    expect(
      announcementView(sample({ mentionEveryone: true })).mentions?.everyone,
    ).toBe(true);
  });

  it('rejects messages over the Discord limit', () => {
    expect(() =>
      announcementView(sample({ content: 'x'.repeat(2001) })),
    ).toThrow('2000');
  });
});

describe.skipIf(noDatabase)('announcement service', () => {
  const setup = (options: { canPost?: boolean; now?: Date } = {}) => {
    const { messenger } = fakeMessenger();
    const scheduler = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
    };
    const repository = createAnnouncementRepository(testDb());
    const service = createAnnouncementService({
      announcements: repository,
      scheduler,
      messenger,
      directory: fakeDirectory(
        [role({ id: 'team' }), role({ id: 'secret', mentionable: false })],
        { canPost: options.canPost ?? true },
      ),
      authz: allowAll,
      log: silentLog,
      clock: { now: () => options.now ?? new Date() },
      timezone: 'Europe/Tallinn',
    });

    return {
      service,
      messenger,
      repository,
      author: actor({ guildId: snowflake() }),
    };
  };

  it('publishes a draft exactly once', async () => {
    const { service, messenger, author } = setup();
    const draft = await service.draft(author, {
      channelId: 'c',
      content: 'Hi',
      mentionRoleIds: ['team'],
    });

    await service.publish(author, draft.id);
    await expect(service.publish(author, draft.id)).rejects.toThrow(
      'cannot be published',
    );
    expect(messenger.send).toHaveBeenCalledOnce();
  });

  it('refuses unmentionable roles, everyone and channels the author cannot use', async () => {
    const { service, author } = setup();

    await expect(
      service.draft(author, {
        channelId: 'c',
        content: 'x',
        mentionRoleIds: ['secret'],
      }),
    ).rejects.toThrow('may not mention');
    await expect(
      service.draft(author, {
        channelId: 'c',
        content: 'x',
        mentionEveryone: true,
      }),
    ).rejects.toThrow('everyone');
    await expect(
      setup({ canPost: false }).service.draft(author, {
        channelId: 'c',
        content: 'x',
      }),
    ).rejects.toThrow('cannot post');
  });

  it('skips scheduled announcements that are long overdue', async () => {
    const { service, messenger, repository, author } = setup();
    const draft = await service.draft(author, {
      channelId: 'c',
      content: 'Hi',
    });

    await repository.transition(draft.id, ['draft'], {
      status: 'scheduled',
      scheduledAt: new Date(Date.now() - 2 * 3_600_000),
    });
    await service.jobs[0]?.run({ announcementId: draft.id });
    expect(messenger.send).not.toHaveBeenCalled();
    expect((await repository.find(draft.id))?.status).toBe('failed');
  });

  it('publishes due scheduled announcements once', async () => {
    const { service, messenger, repository, author } = setup();
    const draft = await service.draft(author, {
      channelId: 'c',
      content: 'Hi',
    });
    const job = service.jobs[0];

    await repository.transition(draft.id, ['draft'], {
      status: 'scheduled',
      scheduledAt: new Date(),
    });
    await job?.run({ announcementId: draft.id });
    await job?.run({ announcementId: draft.id });
    expect(messenger.send).toHaveBeenCalledOnce();
    expect((await repository.find(draft.id))?.status).toBe('published');
  });

  it('lets only one concurrent publish claim a draft', async () => {
    const { service, repository, author } = setup();
    const draft = await service.draft(author, {
      channelId: 'c',
      content: 'Hi',
    });
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        repository.transition(draft.id, ['draft'], { status: 'publishing' }),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
