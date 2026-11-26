import { withMentions, type Mentions, type Message } from './message';

export interface Post {
  title?: string | null;
  content: string;
  mentions?: Mentions;
}

export function renderPost(post: Post): Message {
  const heading =
    post.title === null || post.title === undefined ? '' : `# ${post.title}\n`;

  return withMentions(
    { content: `${heading}${post.content}`, mentions: {} },
    post.mentions ?? {},
  );
}
