import { roleMention, type Message } from './message';

export interface Post {
  title?: string | null;
  content: string;
  mentionRoleIds?: readonly string[];
}

export function renderPost(post: Post): Message {
  const roles = post.mentionRoleIds ?? [];
  const pings = roles.map((id) => roleMention(id)).join(' ');
  const heading =
    post.title === null || post.title === undefined ? '' : `# ${post.title}\n`;

  return {
    content: [pings, `${heading}${post.content}`].filter(Boolean).join('\n'),
    mentions: { roles },
  };
}
