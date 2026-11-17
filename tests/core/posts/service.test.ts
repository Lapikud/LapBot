import type { Scheduler } from '~/core/ports';
import { describe, expect, it, vi } from 'vitest';
import { createPostService } from '~/core/posts';
import { createAuthorizer } from '~/core/authorization';
import { createPostRepository, createGrantRepository } from '~/infra/db';
import type { Permission } from '~/domain';
import { PermanentError } from '~/domain';
import {
  actor,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from '../../fakes';
import { noDatabase, snowflake, testDb } from '../../db';

describe.skipIf(noDatabase)('managed post API', () => {
  const setup = async (
    permissions: Permission[] = [
      'announcement:create',
      'announcement:publish',
      'announcement:schedule',
    ],
  ) => {
    const author = actor({ guildId: snowflake(), roleIds: ['staff'] });
    const grants = createGrantRepository(testDb());

    for (const permission of permissions) {
      await grants.grant({
        guildId: author.guildId,
        roleId: 'staff',
        permission,
        grantedBy: 'admin',
      });
    }

    const authz = createAuthorizer(grants);
    const posts = createPostRepository(testDb());
    const directory = fakeDirectory([
      role({ id: 'team' }),
      role({ id: 'secret', mentionable: false }),
    ]);
    const { messenger } = fakeMessenger();
    const scheduler = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
    };
    let now = new Date('2026-11-17T12:00:00Z');
    const service = createPostService({
      posts,
      authz,
      directory,
      messenger,
      scheduler,
      log: silentLog,
      clock: { now: () => now },
      timezone: 'UTC',
    });
    const draft = () =>
      service.draft(author, {
        channelId: 'c',
        content: 'Hello',
        mentionRoleIds: ['team'],
      });

    return {
      service,
      author,
      posts,
      directory,
      messenger,
      scheduler,
      draft,
      advance: (date: Date) => {
        now = date;
      },
    };
  };

  it('uses the post lifecycle directly and never repeats mentions on edits', async () => {
    const { service, author, posts, messenger, draft } = await setup();
    const post = await draft();

    await service.publish(author, post.id);
    await service.edit(author, post.id, { content: 'Updated' });
    expect(await posts.find(post.id)).toMatchObject({
      status: 'published',
      content: 'Updated',
    });
    expect(messenger.edit.mock.calls[0]?.[2].mentions).toEqual({});
    await expect(service.publish(author, post.id)).rejects.toThrow(
      'already published',
    );
  });

  it('hides other communities invisible channels and another authors drafts', async () => {
    const { service, author, posts, directory, draft } = await setup([]);
    const post = await posts.insert({
      guildId: author.guildId,
      authorId: 'other',
      channelId: 'c',
      title: null,
      content: 'Hidden',
      mentionRoleIds: [],
      mentionEveryone: false,
    });

    await expect(service.get(author, post.id)).rejects.toThrow(
      'does not exist',
    );
    await expect(
      service.edit(author, post.id, { content: 'Changed' }),
    ).rejects.toThrow();
    await expect(
      service.get(actor({ guildId: 'other' }), post.id),
    ).rejects.toThrow();
    directory.canView.mockResolvedValue(false);
    await expect(
      service.get({ ...author, userId: 'other' }, post.id),
    ).rejects.toThrow();
    expect(await service.list(author)).toEqual([]);
    await expect(draft()).rejects.toThrow();
  });

  it('requires publication and scheduling permissions even for the author', async () => {
    const { service, author, draft } = await setup(['announcement:create']);
    const post = await draft();

    await expect(service.publish(author, post.id)).rejects.toThrow();
    await expect(service.schedule(author, post.id, '1h')).rejects.toThrow();
    await service.cancel(author, post.id);
    await expect(service.cancel(author, post.id)).rejects.toThrow(
      'already cancelled',
    );
  });

  it('rechecks channel access and mention permissions before publication', async () => {
    const { service, author, directory, draft } = await setup();

    await expect(
      service.draft(author, {
        channelId: 'c',
        content: 'x',
        mentionEveryone: true,
      }),
    ).rejects.toThrow('everyone');
    await expect(
      service.draft(author, {
        channelId: 'c',
        content: 'x',
        mentionRoleIds: ['secret'],
      }),
    ).rejects.toThrow('may not mention');
    const post = await draft();

    directory.canPost.mockResolvedValue(false);
    await expect(service.publish(author, post.id)).rejects.toThrow(
      'cannot post',
    );
  });

  it('allows one concurrent publication and records the resulting reference', async () => {
    const { service, author, posts, messenger, draft } = await setup();
    const post = await draft();
    const attempts = await Promise.allSettled([
      service.publish(author, post.id),
      service.publish(author, post.id),
    ]);

    expect(
      attempts.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(messenger.send).toHaveBeenCalledOnce();
    expect((await posts.find(post.id))?.messageId).toBeDefined();
  });

  it('keeps legacy queued jobs keys future retries and lateness handling', async () => {
    const { service, author, posts, scheduler, messenger, advance, draft } =
      await setup();
    const post = await draft();

    await service.schedule(author, post.id, '1h');
    const job = service.jobs[0];

    expect(job?.type).toBe('announcements.publish');
    expect(scheduler.schedule.mock.calls[0]?.[1]).toEqual({
      announcementId: post.id,
    });
    expect(scheduler.schedule.mock.calls[0]?.[2]).toEqual({
      runAt: new Date('2026-11-17T13:00:00Z'),
      key: `announcement:${post.id}`,
    });
    await expect(job?.run({ announcementId: post.id })).resolves.toEqual({
      rescheduleAt: new Date('2026-11-17T13:00:00Z'),
    });
    advance(new Date('2026-11-17T14:00:00.001Z'));
    await job?.run({ announcementId: post.id });
    expect(messenger.send).not.toHaveBeenCalled();
    expect((await posts.find(post.id))?.status).toBe('draft');
  });

  it('restores scheduled state on transient failure and draft on permanent failure', async () => {
    const { service, author, posts, messenger, advance, draft } = await setup();
    const post = await draft();

    await service.schedule(author, post.id, '1h');
    advance(new Date('2026-11-17T13:00:00Z'));
    messenger.send.mockRejectedValueOnce(new Error('temporary'));
    await expect(
      service.jobs[0]?.run({ announcementId: post.id }),
    ).rejects.toThrow('temporary');
    expect(await posts.find(post.id)).toMatchObject({
      status: 'scheduled',
      publishedAt: null,
      failure: 'temporary',
    });
    messenger.send.mockRejectedValueOnce(new PermanentError('deleted channel'));
    await expect(
      service.jobs[0]?.run({ announcementId: post.id }),
    ).rejects.toThrow('deleted channel');
    expect(await posts.find(post.id)).toMatchObject({
      status: 'draft',
      publishedAt: null,
    });
  });
});
