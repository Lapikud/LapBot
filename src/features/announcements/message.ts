import type { Announcement } from './model';
import { maxContentLength, type Message } from '~/foundation/message';
import { UserError } from '~/foundation/errors';
import { renderPost } from '~/foundation/posts';

export function announcementView(post: Announcement): Message {
  const message = renderPost(post);

  if ((message.content?.length ?? 0) > maxContentLength) {
    throw new UserError(
      'Announcements are limited to 2000 characters, including the title and mentions.',
    );
  }

  return message;
}
