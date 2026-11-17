import type { Child } from 'hono/jsx';
import type { Permission } from '~/core/permission';
import { maxAnnouncementLength } from '~/features/announcements/service';
import { FormActions } from '~/web/components/actions';
import { Input, Textarea } from '~/web/components/controls';
import { ChannelSelect } from '~/web/components/selectors';
import { type Server } from '~/web/context';
import { MentionPicker } from './mentions';
import type { Draft } from './submission';

export const actions: ReadonlyArray<
  readonly [
    value: string,
    label: string,
    variant: string | undefined,
    needs?: Permission,
  ]
> = [
  ['preview', 'Preview', 'secondary outline'],
  ['draft', 'Save draft', 'secondary'],
  ['schedule', 'Schedule', 'secondary', 'announcement:schedule'],
  ['publish', 'Publish now', undefined, 'announcement:publish'],
];

export function Composer({
  server,
  can,
  draft,
  preview,
}: Readonly<{
  server: Server;
  can: ReadonlySet<Permission>;
  draft?: Draft;
  preview?: Child;
}>) {
  return (
    <form method="post" action="/post/announcements">
      <ChannelSelect
        server={server}
        {...(draft && { selected: draft.channelId })}
      />
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
      <MentionPicker server={server} draft={draft} />
      <Input
        label="Publish later"
        name="when"
        value={draft?.when}
        placeholder="e.g. 2h, tomorrow 9:00, fri 18:00"
      />
      {preview}
      <FormActions>
        {actions
          .filter(([, , , needs]) => needs === undefined || can.has(needs))
          .map(([value, label, variant]) => (
            <button
              key={value}
              type="submit"
              name="action"
              value={value}
              class={variant}
            >
              {label}
            </button>
          ))}
      </FormActions>
    </form>
  );
}
