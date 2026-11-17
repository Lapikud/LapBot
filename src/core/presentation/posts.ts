import {
  maxContentLength,
  roleMention,
  UserError,
  type Message,
} from '~/domain';
import type { Post } from '~/core/ports';
export function postView(announcement: Post): Message {
  const pings = [
    ...(announcement.mentionEveryone ? ['@everyone'] : []),
    ...announcement.mentionRoleIds.map((id) => roleMention(id)),
  ].join(' ');
  const mentions = {
    everyone: announcement.mentionEveryone,
    roles: announcement.mentionRoleIds,
  };

  const heading =
    announcement.title === null ? '' : `# ${announcement.title}\n`;
  const content = [pings, `${heading}${announcement.content}`]
    .filter(Boolean)
    .join('\n');

  if (content.length > maxContentLength) {
    throw new UserError(
      'Announcements are limited to 2000 characters, including the title and mentions.',
    );
  }

  return { content, mentions };
}
