import type {
  MovieSuggestion,
  NewSuggestion,
  Screening,
  WatchedMovie,
} from '~/domain/movies';
export type MovieRepository = {
  suggest: (suggestion: NewSuggestion) => Promise<MovieSuggestion>;
  find: (guildId: string, id: number) => Promise<MovieSuggestion>;
  unwatched: (guildId: string, limit?: number) => Promise<MovieSuggestion[]>;
  remove: (id: number) => Promise<void>;
  setLinks: (id: number, links: readonly string[]) => Promise<void>;
  recordScreening: (screening: Screening) => Promise<number>;
  markWatched: (
    guildId: string,
    suggestionId: number,
    at: Date,
  ) => Promise<void>;
  history: (guildId: string, limit?: number) => Promise<WatchedMovie[]>;
};
