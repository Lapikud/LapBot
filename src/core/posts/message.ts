import {
  maxContentLength,
  roleMention,
  UserError,
  type Message,
} from '~/domain';
import type { Post } from '~/domain/posts';
export function postView(post: Post): Message {
  const pings = [
    ...(post.mentionEveryone ? ['@everyone'] : []),
    ...post.mentionRoleIds.map((id) => roleMention(id)),
  ].join(' ');
  const mentions = {
    everyone: post.mentionEveryone,
    roles: post.mentionRoleIds,
  };

  const heading = post.title === null ? '' : `# ${post.title}\n`;
  const content = [pings, `${heading}${post.content}`]
    .filter(Boolean)
    .join('\n');

  if (content.length > maxContentLength) {
    throw new UserError(
      'Announcements are limited to 2000 characters, including the title and mentions.',
    );
  }

  return { content, mentions };
}
