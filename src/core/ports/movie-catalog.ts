import type { MovieDetails } from '~/domain/movies';

export type MovieCatalog = {
  lookup: (title: string, year: number | null) => Promise<MovieDetails | null>;
};
