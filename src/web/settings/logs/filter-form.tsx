import { levels } from './filters';

interface Props {
  readonly live: boolean;
  readonly minimum: { name: string; value: number };
  readonly query: string;
}
export function LogFilters({ live, minimum, query }: Props) {
  return (
    <form method="get" action="/settings/logs">
      <input type="hidden" name="live" value={live ? '1' : '0'} />
      <div class="grid">
        <label>
          Minimum level
          <select name="level">
            {levels.map((level) => (
              <option
                key={level.name}
                value={level.name}
                selected={minimum.name === level.name}
              >
                {level.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input
            type="search"
            name="q"
            value={query}
            maxlength={200}
            placeholder="Message, source or details"
          />
        </label>
      </div>
      <button type="submit" class="secondary">
        Apply filters
      </button>
    </form>
  );
}
