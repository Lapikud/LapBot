import type { Message } from '~/core/message';
import type { Permission } from '~/core/permission';
import { MessagePreview } from '~/web/components/preview';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { Composer } from './form';
import type { Draft } from './submission';

interface Props {
  title: string;
  action: string;
  server: Server;
  can: ReadonlySet<Permission>;
  flash?: Flash;
  published?: boolean;
  draft?: Draft | undefined;
  view?: readonly Message[];
}

export function ComposerPage({
  title,
  action,
  server,
  can,
  flash = {},
  published = false,
  draft,
  view,
}: Readonly<Props>) {
  return (
    <Layout can={can} title={title} path="/announcements" flash={flash}>
      <Composer
        server={server}
        action={action}
        published={published}
        draft={draft}
        preview={
          view && (
            <>
              <h2>Preview</h2>
              {view.map((message) => (
                <MessagePreview
                  key={message.content}
                  message={message}
                  server={server}
                />
              ))}
            </>
          )
        }
      />
    </Layout>
  );
}
