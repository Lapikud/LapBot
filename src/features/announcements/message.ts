import { splitContent, type Message } from '~/core/message';
import { renderPost, type Post } from '~/core/posts';

export function announcementView(post: Post): Message[] {
  const { content = '', mentions = {} } = renderPost(post);

  return splitContent(content).map((part, index) => ({
    content: part,
    mentions: index === 0 ? mentions : {},
  }));
}
