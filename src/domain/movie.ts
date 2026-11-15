export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const movieLabel = (movie: { title: string; year: number | null }) =>
  movie.year === null ? movie.title : `${movie.title} (${movie.year})`;
