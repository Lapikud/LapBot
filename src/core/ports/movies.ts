export type MovieSuggestion = {
  id: number;
  guildId: string;
  title: string;
  normalizedTitle: string;
  year: number | null;
  note: string | null;
  suggestedBy: string;
  tmdbId: number | null;
  overview: string | null;
  posterUrl: string | null;
  trailerUrl: string | null;
  links: string[];
  createdAt: Date;
  removedAt: Date | null;
};

export type MovieDetails = {
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  trailerUrl: string | null;
};

export type MovieCatalog = {
  lookup: (title: string, year: number | null) => Promise<MovieDetails | null>;
};

export type NewSuggestion = Pick<
  MovieSuggestion,
  | 'guildId'
  | 'title'
  | 'year'
  | 'note'
  | 'suggestedBy'
  | 'tmdbId'
  | 'overview'
  | 'posterUrl'
  | 'trailerUrl'
  | 'links'
>;

export type Screening = {
  guildId: string;
  suggestionId: number;
  eventId?: number | null;
  pollId?: number | null;
  scheduledFor?: Date | null;
};

export type WatchedMovie = {
  title: string;
  year: number | null;
  watchedAt: Date | null;
};

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
