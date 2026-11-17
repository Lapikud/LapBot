import { createPostService, type PostDeps } from './posts';
import type { PostRepository } from '~/core/ports';

export { postView as announcementView } from '~/core/presentation';
export { maxPostLength as maxAnnouncementLength } from './posts';
export type { PostDraft as AnnouncementDraft } from './posts';

export function createAnnouncementService({
  announcements,
  ...deps
}: Omit<PostDeps, 'posts'> & { announcements: PostRepository }) {
  return createPostService({ ...deps, posts: announcements });
}

export type AnnouncementService = ReturnType<typeof createAnnouncementService>;
