import type { Child } from 'hono/jsx';
import type { Permission } from '~/core/permission';
import { maxAnnouncementLength } from '~/features/announcements/service';
import { FormActions } from '~/web/components/actions';
import { Input, Textarea } from '~/web/components/controls';
import { ChannelSelect } from '~/web/components/selectors';
import { type Server } from '~/web/context';
import { MentionPicker } from '~/web/components/mentions';
import type { Draft } from './submission';

const actions = [
  ['preview', 'Preview', 'secondary outline', 'announcement:create'],
  ['draft', 'Save draft', 'secondary', 'announcement:create'],
  ['schedule', 'Schedule', 'secondary', 'announcement:schedule'],
  ['publish', 'Publish now', undefined, 'announcement:publish'],
] as const;

export function Composer({
  server,
  can,
  action,
  published = false,
  draft,
  preview,
}: Readonly<{
  server: Server;
  can: ReadonlySet<Permission>;
  action: string;
  published?: boolean;
  draft?: Draft | undefined;
  preview?: Child;
}>) {
  return (
    <form method="post" action={action}>
      {published ? null : (
        <ChannelSelect
          server={server}
          {...(draft && { selected: draft.channelId })}
        />
      )}
      <Input label="Title" name="title" maxlength={256} value={draft?.title} />
      <Textarea
        label="Message"
        name="content"
        rows={8}
        maxlength={maxAnnouncementLength}
        required
      >
        {draft?.content}
      </Textarea>
      {published ? null : (
        <>
          <MentionPicker server={server} mentions={draft?.mentions} />
          <Input
            label="Publish later"
            name="when"
            value={draft?.when}
            placeholder="e.g. 2h, tomorrow 9:00, fri 18:00"
          />
        </>
      )}
      {preview}
      <FormActions>
        {(published ? actions.slice(0, 2) : actions)
          .filter(([, , , needs]) => can.has(needs))
          .map(([value, label, variant]) => (
            <button
              key={value}
              type="submit"
              name="action"
              value={value}
              class={variant}
            >
              {published && value === 'draft' ? 'Save' : label}
            </button>
          ))}
      </FormActions>
    </form>
  );
}
