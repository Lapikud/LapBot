import { splitContent, userMention, type Message } from '~/core/message';
import { renderPost, type Post } from '~/core/posts';

export function announcementView(post: Post & { authorId: string }): Message[] {
  const { content = '', mentions = {} } = renderPost(post);

  return splitContent(
    `${content}\n-# toimetaja: ${userMention(post.authorId)}`,
  ).map((part, index) => ({
    content: part,
    mentions: index === 0 ? mentions : {},
  }));
}
