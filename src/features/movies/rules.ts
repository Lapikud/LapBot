import { UserError } from '~/core/errors';

export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const movieLabel = (movie: { title: string; year: number | null }) =>
  movie.year === null ? movie.title : `${movie.title} (${movie.year})`;

export const maxMovieLinks = 5;

export const tmdbPage = (id: number) =>
  `https://www.themoviedb.org/movie/${id}`;

export function validateLinks(links: readonly string[]): string[] {
  const trimmed = links
    .map((link) => link.trim())
    .filter((link) => link !== '');

  if (trimmed.length > maxMovieLinks) {
    throw new UserError(`Add at most ${maxMovieLinks} links.`);
  }

  for (const link of trimmed) {
    if (!URL.canParse(link) || !/^https?:$/.test(new URL(link).protocol)) {
      throw new UserError(`"${link.slice(0, 80)}" is not a web link.`);
    }
  }

  return [...new Set(trimmed)];
}

export type MovieLink = { label: string; url: string };

export function movieLinks(movie: {
  trailerUrl: string | null;
  tmdbId: number | null;
  links: readonly string[];
}): MovieLink[] {
  return [
    ...(movie.trailerUrl === null
      ? []
      : [{ label: 'Trailer', url: movie.trailerUrl }]),
    ...(movie.tmdbId === null
      ? []
      : [{ label: 'TMDB', url: tmdbPage(movie.tmdbId) }]),
    ...movie.links.map((url) => ({
      label: new URL(url).hostname.replace(/^www\./, ''),
      url,
    })),
  ];
}
