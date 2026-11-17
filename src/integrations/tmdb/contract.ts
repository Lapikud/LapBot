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
