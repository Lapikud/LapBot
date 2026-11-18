export interface Mentions {
  users?: readonly string[];
  roles?: readonly string[];
  here?: boolean;
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: readonly EmbedField[];
  footer?: string;
}

export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger';

export type Control =
  | { kind: 'button'; id: string; label: string; style: ButtonStyle }
  | {
      kind: 'select';
      id: string;
      placeholder: string;
      min: number;
      max: number;
      options: ReadonlyArray<{
        label: string;
        value: string;
        default?: boolean;
      }>;
    };

export interface Message {
  content?: string;
  embeds?: readonly Embed[];
  mentions?: Mentions;
  controls?: ReadonlyArray<readonly Control[]>;
  suppressEmbeds?: boolean;
}

export const maxContentLength = 2000;

export function splitContent(text: string, limit = maxContentLength): string[] {
  const parts: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    const newline = window.lastIndexOf('\n');
    const space = window.lastIndexOf(' ');
    const fallback = space > 0 ? space : limit;
    const cut = newline > limit / 2 ? newline : fallback;

    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]/, '');
  }

  return [...parts, rest];
}

export const userMention = (id: string) => `<@${id}>`;

export const roleMention = (id: string) => `<@&${id}>`;

export const channelMention = (id: string) => `<#${id}>`;

export const hereMention = () => '@here';

export const controlId = (prefix: string, ...args: Array<string | number>) => {
  const id = [prefix, ...args].join(':');

  if (id.length > 100) {
    throw new Error(`Control ID exceeds 100 characters: ${id}`);
  }

  return id;
};
