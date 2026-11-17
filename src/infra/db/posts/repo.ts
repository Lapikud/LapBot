import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PostChanges, NewPost } from '~/domain/posts';
import type { PostRepository } from '~/core/posts';
import type { Db } from '../client';
import { posts, type PostRow } from './model';

type Status = PostRow['status'];

export async function insertPost(db: Db, input: NewPost): Promise<PostRow> {
  const [row] = await db.insert(posts).values(input).returning();

  if (!row) {
    throw new Error('Insert returned no row');
  }

  return row;
}

export async function getPost(
  db: Db,
  id: number,
): Promise<PostRow | undefined> {
  const [row] = await db.select().from(posts).where(eq(posts.id, id));

  return row;
}

export async function listPosts(
  db: Db,
  guildId: string,
  limit = 50,
): Promise<PostRow[]> {
  return db
    .select()
    .from(posts)
    .where(eq(posts.guildId, guildId))
    .orderBy(desc(posts.id))
    .limit(limit);
}

export async function updatePost(
  db: Db,
  id: number,
  changes: PostChanges,
  onlyIf?: readonly Status[],
): Promise<PostRow | undefined> {
  const [row] = await db
    .update(posts)
    .set(changes)
    .where(and(eq(posts.id, id), onlyIf && inArray(posts.status, [...onlyIf])))
    .returning();

  return row;
}

export function createPostRepository(db: Db): PostRepository {
  return {
    insert: (post) => insertPost(db, post),
    find: (id) => getPost(db, id),
    list: (guildId, limit) => listPosts(db, guildId, limit),
    update: (id, changes, onlyIf) => updatePost(db, id, changes, onlyIf),
  };
}
