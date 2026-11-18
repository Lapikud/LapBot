import type { Message } from '~/core/message';
import type { Permission } from '~/core/permission';
import { MessagePreview } from '~/web/components/preview';
import { type Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { Composer } from './form';
import type { Draft } from './submission';

interface Props {
  server: Server;
  can: ReadonlySet<Permission>;
  draft: Draft;
  view: readonly Message[];
}

export function AnnouncementPreviewPage({
  server,
  can,
  draft,
  view,
}: Readonly<Props>) {
  return (
    <Layout can={can} title="New PSA" path="/post/announcements">
      <Composer
        can={can}
        server={server}
        draft={draft}
        preview={
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
        }
      />
    </Layout>
  );
}
