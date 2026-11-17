import { describe, expect, it, vi } from 'vitest';
import type { Announcement } from '~/features/announcements/model';
import type { Scheduler } from '~/core/ports/scheduler';
import { announcementView } from '~/features/announcements/message';
import { createAnnouncementService } from '~/features/announcements/service';
import { createAnnouncementRepository } from '~/features/announcements/repository';
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
    ).toEqual({
      everyone: false,
      roles: [],
    });
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
    ).toThrow(
      /^Announcements are limited to 2000 characters, including the title and mentions\.$/,
    );
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
      posts: repository,
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

  it('goes back to draft with the reason when posting fails', async () => {
    const { service, messenger, repository, author } = setup();
    const draft = await service.draft(author, {
      channelId: 'c',
      content: 'Hi',
    });

    messenger.send.mockRejectedValueOnce(new Error('Discord is down'));
    await expect(service.publish(author, draft.id)).rejects.toThrow('down');
    expect(await repository.find(draft.id)).toMatchObject({
      status: 'draft',
      publishedAt: null,
      failure: 'Discord is down',
    });
  });

  it('publishes due scheduled announcements once', async () => {
    const { service, messenger, repository, author } = setup();
    const draft = await service.draft(author, {
      channelId: 'c',
      content: 'Hi',
    });
    const job = service.jobs[0];

    await repository.update(draft.id, {
      status: 'scheduled',
      scheduledAt: new Date(),
    });
    await job?.run({ announcementId: draft.id });
    await job?.run({ announcementId: draft.id });
    expect(messenger.send).toHaveBeenCalledOnce();
    expect((await repository.find(draft.id))?.status).toBe('published');
  });
});
