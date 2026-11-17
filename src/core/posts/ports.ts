import type { PostStatus, Post, NewPost, PostChanges } from '~/domain/posts';
export type PostRepository = {
  insert: (post: NewPost) => Promise<Post>;
  find: (id: number) => Promise<Post | undefined>;
  list: (guildId: string, limit?: number) => Promise<Post[]>;
  update: (
    id: number,
    changes: PostChanges,
    onlyIf?: readonly PostStatus[],
  ) => Promise<Post | undefined>;
};
