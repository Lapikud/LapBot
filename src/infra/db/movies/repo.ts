import { and, asc, desc, eq, isNotNull, isNull, notExists } from 'drizzle-orm';
import type { MovieRepository } from '~/core/movies';
import type { NewSuggestion } from '~/domain/movies';
import type { Db } from '../client';
import { normalizeTitle } from '~/domain/movies';
import { UserError } from '~/domain';
import {
  movieScreenings,
  movieSuggestions,
  type MovieSuggestion,
} from './model';

const watched = (db: Db) =>
  db
    .select({ id: movieScreenings.id })
    .from(movieScreenings)
    .where(
      and(
        eq(movieScreenings.suggestionId, movieSuggestions.id),
        isNotNull(movieScreenings.watchedAt),
      ),
    );

export async function suggestMovie(
  db: Db,
  input: NewSuggestion,
): Promise<MovieSuggestion> {
  const normalizedTitle = normalizeTitle(input.title);

  if (normalizedTitle === '') {
    throw new UserError('Give a movie title.');
  }

  const [row] = await db
    .insert(movieSuggestions)
    .values({ ...input, title: input.title.trim(), normalizedTitle })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    const existing = await findActive(db, input.guildId, normalizedTitle);
    const when = existing && (await lastWatched(db, existing.id));

    throw new UserError(
      when
        ? `That movie was already watched (${when.toISOString().slice(0, 10)}).`
        : 'That movie is already suggested.',
    );
  }

  return row;
}

async function findActive(db: Db, guildId: string, normalizedTitle: string) {
  const [row] = await db
    .select()
    .from(movieSuggestions)
    .where(
      and(
        eq(movieSuggestions.guildId, guildId),
        eq(movieSuggestions.normalizedTitle, normalizedTitle),
        isNull(movieSuggestions.removedAt),
      ),
    );

  return row;
}

export async function lastWatched(
  db: Db,
  suggestionId: number,
): Promise<Date | undefined> {
  const [row] = await db
    .select({ watchedAt: movieScreenings.watchedAt })
    .from(movieScreenings)
    .where(
      and(
        eq(movieScreenings.suggestionId, suggestionId),
        isNotNull(movieScreenings.watchedAt),
      ),
    )
    .orderBy(desc(movieScreenings.watchedAt))
    .limit(1);

  return row?.watchedAt ?? undefined;
}

export async function requireSuggestion(
  db: Db,
  guildId: string,
  id: number,
): Promise<MovieSuggestion> {
  const [row] = await db
    .select()
    .from(movieSuggestions)
    .where(
      and(
        eq(movieSuggestions.id, id),
        eq(movieSuggestions.guildId, guildId),
        isNull(movieSuggestions.removedAt),
      ),
    );

  if (!row) {
    throw new UserError(`Movie #${id} is not on the list.`);
  }

  return row;
}

export async function listUnwatched(
  db: Db,
  guildId: string,
  limit = 25,
): Promise<MovieSuggestion[]> {
  return db
    .select()
    .from(movieSuggestions)
    .where(
      and(
        eq(movieSuggestions.guildId, guildId),
        isNull(movieSuggestions.removedAt),
        notExists(watched(db)),
      ),
    )
    .orderBy(asc(movieSuggestions.createdAt))
    .limit(limit);
}

export async function removeSuggestion(db: Db, id: number): Promise<void> {
  await db
    .update(movieSuggestions)
    .set({ removedAt: new Date() })
    .where(eq(movieSuggestions.id, id));
}

export async function setMovieLinks(
  db: Db,
  id: number,
  links: readonly string[],
): Promise<void> {
  await db
    .update(movieSuggestions)
    .set({ links: [...links] })
    .where(eq(movieSuggestions.id, id));
}

export async function recordScreening(
  db: Db,
  input: {
    guildId: string;
    suggestionId: number;
    eventId?: number | null;
    pollId?: number | null;
    scheduledFor?: Date | null;
  },
): Promise<number> {
  const [row] = await db
    .insert(movieScreenings)
    .values(input)
    .returning({ id: movieScreenings.id });

  if (!row) {
    throw new Error('Insert returned no row');
  }

  return row.id;
}

export async function markWatched(
  db: Db,
  guildId: string,
  suggestionId: number,
  watchedAt: Date,
): Promise<void> {
  const [pending] = await db
    .select({ id: movieScreenings.id })
    .from(movieScreenings)
    .where(
      and(
        eq(movieScreenings.suggestionId, suggestionId),
        isNull(movieScreenings.watchedAt),
      ),
    )
    .orderBy(desc(movieScreenings.createdAt))
    .limit(1);

  await (pending
    ? db
        .update(movieScreenings)
        .set({ watchedAt })
        .where(eq(movieScreenings.id, pending.id))
    : db.insert(movieScreenings).values({ guildId, suggestionId, watchedAt }));
}

export async function watchHistory(db: Db, guildId: string, limit = 25) {
  return db
    .select({
      title: movieSuggestions.title,
      year: movieSuggestions.year,
      watchedAt: movieScreenings.watchedAt,
    })
    .from(movieScreenings)
    .innerJoin(
      movieSuggestions,
      eq(movieSuggestions.id, movieScreenings.suggestionId),
    )
    .where(
      and(
        eq(movieScreenings.guildId, guildId),
        isNotNull(movieScreenings.watchedAt),
      ),
    )
    .orderBy(desc(movieScreenings.watchedAt))
    .limit(limit);
}

export function createMovieRepository(db: Db): MovieRepository {
  return {
    suggest: (suggestion) => suggestMovie(db, suggestion),
    find: (guildId, id) => requireSuggestion(db, guildId, id),
    unwatched: (guildId, limit) => listUnwatched(db, guildId, limit),
    remove: (id) => removeSuggestion(db, id),
    setLinks: (id, links) => setMovieLinks(db, id, links),
    recordScreening: (screening) => recordScreening(db, screening),
    markWatched: (guildId, suggestionId, at) =>
      markWatched(db, guildId, suggestionId, at),
    history: (guildId, limit) => watchHistory(db, guildId, limit),
  };
}
