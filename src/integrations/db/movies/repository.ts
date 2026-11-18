import { and, asc, desc, eq, isNotNull, isNull, notExists } from 'drizzle-orm';
import type { MovieRepository } from '~/features/movies/model';
import type { Db } from '../client';
import { normalizeTitle } from '~/features/movies/rules';
import { UserError } from '~/core/errors';
import { movieScreenings, movieSuggestions } from './table';

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

export function createMovieRepository(db: Db): MovieRepository {
  return {
    suggest: async (input) => {
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
    },
    find: async (guildId, id) => {
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
    },
    unwatched: async (guildId, limit = 25) => {
      return await db
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
    },
    remove: async (id) => {
      await db
        .update(movieSuggestions)
        .set({ removedAt: new Date() })
        .where(eq(movieSuggestions.id, id));
    },
    setLinks: async (id, links) => {
      await db
        .update(movieSuggestions)
        .set({ links: [...links] })
        .where(eq(movieSuggestions.id, id));
    },
    recordScreening: async (input) => {
      const [row] = await db
        .insert(movieScreenings)
        .values(input)
        .returning({ id: movieScreenings.id });

      if (!row) {
        throw new Error('Insert returned no row');
      }

      return row.id;
    },
    markWatched: async (guildId, suggestionId, watchedAt) => {
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
        : db
            .insert(movieScreenings)
            .values({ guildId, suggestionId, watchedAt }));
    },
    history: async (guildId, limit = 25) => {
      return await db
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
    },
  };
}
