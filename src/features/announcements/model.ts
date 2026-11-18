import type { Post } from '~/core/posts';

export type AnnouncementStatus =
  'draft' | 'scheduled' | 'published' | 'cancelled';

export interface Announcement extends Post {
  id: number;
  guildId: string;
  authorId: string;
  channelId: string;
  title: string | null;
  mentionRoleIds: string[];
  status: AnnouncementStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  messageIds: string[];
  failure: string | null;
  createdAt: Date;
}

export type NewAnnouncement = Pick<
  Announcement,
  'guildId' | 'authorId' | 'channelId' | 'title' | 'content' | 'mentionRoleIds'
>;

export type AnnouncementChanges = Partial<
  Omit<Announcement, 'id' | 'guildId' | 'authorId' | 'createdAt'>
>;

export interface AnnouncementRepository {
  insert: (post: NewAnnouncement) => Promise<Announcement>;
  find: (id: number) => Promise<Announcement | undefined>;
  list: (guildId: string, limit?: number) => Promise<Announcement[]>;
  update: (
    id: number,
    changes: AnnouncementChanges,
    onlyIf?: readonly AnnouncementStatus[],
  ) => Promise<Announcement | undefined>;
}
