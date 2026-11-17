import type { Post } from '~/foundation/posts';

export type AnnouncementStatus =
  'draft' | 'scheduled' | 'published' | 'cancelled';

export type Announcement = Post & {
  id: number;
  guildId: string;
  authorId: string;
  channelId: string;
  title: string | null;
  mentionRoleIds: string[];
  mentionEveryone: boolean;
  status: AnnouncementStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  messageId: string | null;
  failure: string | null;
  createdAt: Date;
};

export type NewAnnouncement = Pick<
  Announcement,
  | 'guildId'
  | 'authorId'
  | 'channelId'
  | 'title'
  | 'content'
  | 'mentionRoleIds'
  | 'mentionEveryone'
>;

export type AnnouncementChanges = Partial<
  Omit<Announcement, 'id' | 'guildId' | 'authorId' | 'createdAt'>
>;

export type AnnouncementRepository = {
  insert: (post: NewAnnouncement) => Promise<Announcement>;
  find: (id: number) => Promise<Announcement | undefined>;
  list: (guildId: string, limit?: number) => Promise<Announcement[]>;
  update: (
    id: number,
    changes: AnnouncementChanges,
    onlyIf?: readonly AnnouncementStatus[],
  ) => Promise<Announcement | undefined>;
};
