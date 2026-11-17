import { TMDB } from 'tmdb-ts';
import type { MovieCatalog } from './contract';

const posterBase = 'https://image.tmdb.org/t/p/w342';

export function createTmdbCatalog(accessToken: string): MovieCatalog {
  const tmdb = new TMDB(accessToken);

  return {
    lookup: async (title, year) => {
      const { results } = await tmdb.search.movies({
        query: title,
        ...(year !== null && { year }),
      });
      const [movie] = results;

      if (!movie) {
        return null;
      }

      const { results: videos } = await tmdb.movies.videos(movie.id);
      const youtube = videos.filter((video) => video.site === 'YouTube');
      const trailer =
        youtube.find((video) => video.type === 'Trailer') ?? youtube[0];
      const released = Number.parseInt(movie.release_date.slice(0, 4), 10);

      return {
        tmdbId: movie.id,
        title: movie.title,
        year: Number.isNaN(released) ? null : released,
        overview: movie.overview === '' ? null : movie.overview,
        posterUrl: movie.poster_path
          ? `${posterBase}${movie.poster_path}`
          : null,
        trailerUrl: trailer
          ? `https://www.youtube.com/watch?v=${trailer.key}`
          : null,
      };
    },
  };
}
