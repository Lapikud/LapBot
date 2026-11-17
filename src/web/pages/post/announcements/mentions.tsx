import { MultiSelect } from '~/web/components/choices';
import { type Server } from '~/web/context';
import type { Draft } from './submission';

export function MentionPicker({
  server,
  draft,
}: Readonly<{ server: Server; draft: Draft | undefined }>) {
  const roles = server.roles.filter((role) => !role.everyone && !role.managed);
  const selected = new Set(draft?.mentionRoleIds ?? []);

  return (
    <MultiSelect
      label="Mention"
      placeholder="Nobody"
      selected={selected}
      choices={roles.map(({ id, name }) => ({
        name: 'role',
        value: id,
        label: `@${name}`,
      }))}
    />
  );
}
