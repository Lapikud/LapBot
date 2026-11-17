import type { Message } from '~/core/message';
import type { Permission } from '~/core/permission';
import { MessagePreview } from '~/web/components/preview';
import { type Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { Composer } from './form';
import type { Draft } from './submission';

interface Props {
  readonly server: Server;
  readonly can: ReadonlySet<Permission>;
  readonly draft: Draft;
  readonly view: Message;
}

export function AnnouncementPreviewPage({ server, can, draft, view }: Props) {
  return (
    <Layout can={can} title="New PSA" path="/post/announcements">
      <Composer
        can={can}
        server={server}
        draft={draft}
        preview={
          <>
            <h2>Preview</h2>
            <MessagePreview message={view} server={server} />
          </>
        }
      />
    </Layout>
  );
}
