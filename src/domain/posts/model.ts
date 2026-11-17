export type PostStatus = 'draft' | 'scheduled' | 'published' | 'cancelled';

export type Post = {
  id: number;
  guildId: string;
  authorId: string;
  channelId: string;
  title: string | null;
  content: string;
  mentionRoleIds: string[];
  mentionEveryone: boolean;
  status: PostStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  messageId: string | null;
  failure: string | null;
  createdAt: Date;
};

export type NewPost = Pick<
  Post,
  | 'guildId'
  | 'authorId'
  | 'channelId'
  | 'title'
  | 'content'
  | 'mentionRoleIds'
  | 'mentionEveryone'
>;

export type PostChanges = Partial<
  Omit<Post, 'id' | 'guildId' | 'authorId' | 'createdAt'>
>;
