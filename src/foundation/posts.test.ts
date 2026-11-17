import { describe, expect, it } from 'vitest';
import { renderPost, type Post } from './posts';

describe('post content', () => {
  it('renders plain content without a lifecycle record or dependencies', () => {
    const post: Post = { content: 'Hello' };

    expect(renderPost(post)).toEqual({
      content: 'Hello',
      mentions: { everyone: false, roles: [] },
    });
  });

  it('composes a heading and explicitly selected mentions', () => {
    expect(
      renderPost({
        title: 'Update',
        content: 'Details',
        mentionRoleIds: ['team'],
        mentionEveryone: true,
      }),
    ).toEqual({
      content: '@everyone <@&team>\n# Update\nDetails',
      mentions: { everyone: true, roles: ['team'] },
    });
  });

  it('does not turn mention text into permission to ping', () => {
    expect(renderPost({ content: '@everyone <@&team>' }).mentions).toEqual({
      everyone: false,
      roles: [],
    });
  });

  it('leaves its input unchanged and keeps feature limits outside rendering', () => {
    const post = Object.freeze({
      title: null,
      content: 'x'.repeat(2001),
      mentionRoleIds: Object.freeze(['team']),
    });

    expect(renderPost(post)).toEqual(renderPost(post));
    expect(renderPost(post).content).toBe(`<@&team>\n${post.content}`);
  });
});
