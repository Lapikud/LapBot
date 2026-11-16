export type AnnouncementStatus =
  'draft' | 'scheduled' | 'publishing' | 'published' | 'cancelled' | 'failed';

export type Announcement = {
  id: number;
  guildId: string;
  authorId: string;
  channelId: string;
  title: string | null;
  content: string;
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
  Omit<Announcement, 'id' | 'guildId' | 'status'>
> & { status: AnnouncementStatus };

export type AnnouncementRepository = {
  insert: (announcement: NewAnnouncement) => Promise<Announcement>;
  find: (id: number) => Promise<Announcement | undefined>;
  list: (guildId: string, limit?: number) => Promise<Announcement[]>;
  transition: (
    id: number,
    from: readonly AnnouncementStatus[],
    changes: AnnouncementChanges,
  ) => Promise<Announcement | undefined>;
  update: (
    id: number,
    changes: Partial<
      Pick<
        Announcement,
        'title' | 'content' | 'channelId' | 'mentionRoleIds' | 'mentionEveryone'
      >
    >,
  ) => Promise<void>;
};
