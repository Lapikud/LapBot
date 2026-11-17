import type { Announcement } from './model';
import { maxContentLength, type Message } from '~/core/message';
import { UserError } from '~/core/errors';
import { renderPost } from '~/core/posts';

export function announcementView(post: Announcement): Message {
  const message = renderPost(post);

  if ((message.content?.length ?? 0) > maxContentLength) {
    throw new UserError(
      'Announcements are limited to 2000 characters, including the title and mentions.',
    );
  }

  return message;
}
