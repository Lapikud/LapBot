import type { Mentions } from '~/core/message';
import type { Server } from '~/web/context';

interface Suggestion {
  value: string;
  label: string;
}

function suggestionsOf(server: Server): Suggestion[] {
  return [
    { value: 'everyone', label: '@everyone' },
    { value: 'here', label: '@here' },
    ...server.roles
      .filter((role) => !role.everyone)
      .map(({ id, name }) => ({ value: `role:${id}`, label: `@${name}` })),
    ...server.members.map(({ id, name, username }) => ({
      value: `user:${id}`,
      label:
        name.toLowerCase() === username ? `@${name}` : `@${name} (${username})`,
    })),
  ];
}

export function MentionPicker({
  server,
  mentions = {},
}: Readonly<{ server: Server; mentions?: Mentions | undefined }>) {
  const suggestions = suggestionsOf(server);
  const labels = new Map(suggestions.map(({ value, label }) => [value, label]));
  const selected = [
    ...(mentions.everyone === true ? ['everyone'] : []),
    ...(mentions.here === true ? ['here'] : []),
    ...(mentions.roles ?? []).map((id) => `role:${id}`),
    ...(mentions.users ?? []).map((id) => `user:${id}`),
  ];

  return (
    <fieldset class="mentions">
      <label htmlFor="mention-search">Mention</label>
      <ul class="chips" aria-label="Mentioned">
        {selected.map((value) => (
          <li key={value}>
            <input type="hidden" name="mention" value={value} />
            {labels.get(value) ?? value}
            <button type="button" class="secondary outline" aria-label="Remove">
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        id="mention-search"
        type="text"
        list="mention-suggestions"
        placeholder="Type @ to search roles and members"
        autocomplete="off"
      />
      <datalist id="mention-suggestions">
        {suggestions.map(({ value, label }) => (
          <option key={value} value={label} data-mention={value} />
        ))}
      </datalist>
      <script src="/mentions.js" defer />
    </fieldset>
  );
}
