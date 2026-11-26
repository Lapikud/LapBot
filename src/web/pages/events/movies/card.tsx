import type { MovieSuggestion } from '~/features/movies/model';
import { movieLabel, movieLinks } from '~/features/movies/rules';
import { ActionButton } from '~/web/components/actions';

export function MovieCard({
  movie,
  suggestedBy,
  editable,
  manager,
}: Readonly<{
  movie: MovieSuggestion;
  suggestedBy: string;
  editable: boolean;
  manager: boolean;
}>) {
  return (
    <article class="movie">
      {movie.posterUrl === null ? (
        <div class="poster" />
      ) : (
        <img class="poster" src={movie.posterUrl} alt="" />
      )}
      <div>
        <h3>{movieLabel(movie)}</h3>
        <small>Suggested by {suggestedBy}</small>
        {movie.note === null ? null : <p>{movie.note}</p>}
        {movie.overview === null ? null : (
          <p class="overview">{movie.overview}</p>
        )}
        <p>
          {movieLinks(movie).map(({ label, url }) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {label}
            </a>
          ))}
        </p>
        {editable ? (
          <>
            <form method="post" action={`/events/movies/${movie.id}/links`}>
              <fieldset class="grid" aria-label="Add a movie link">
                <input
                  name="url"
                  type="url"
                  placeholder="Add a link"
                  aria-label="Link URL"
                  required
                />
                <button type="submit" class="secondary">
                  Add
                </button>
              </fieldset>
            </form>
            <ActionButton
              action={`/events/movies/${movie.id}/remove`}
              label="Remove"
            />
          </>
        ) : null}
        {manager ? (
          <ActionButton
            action={`/events/movies/${movie.id}/watched`}
            label="Watched"
          />
        ) : null}
      </div>
    </article>
  );
}
