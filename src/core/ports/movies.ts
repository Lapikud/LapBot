export type MovieSuggestion = {
  id: number;
  guildId: string;
  title: string;
  normalizedTitle: string;
  year: number | null;
  note: string | null;
  suggestedBy: string;
  createdAt: Date;
  removedAt: Date | null;
};

export type NewSuggestion = Pick<
  MovieSuggestion,
  'guildId' | 'title' | 'year' | 'note' | 'suggestedBy'
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
  recordScreening: (screening: Screening) => Promise<number>;
  markWatched: (
    guildId: string,
    suggestionId: number,
    at: Date,
  ) => Promise<void>;
  history: (guildId: string, limit?: number) => Promise<WatchedMovie[]>;
};
