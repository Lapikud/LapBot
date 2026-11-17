import type { Message } from '~/core/message';

export interface Sent {
  channelId: string;
  messageId: string;
}

export interface Messenger {
  send: (channelId: string, message: Message) => Promise<Sent>;
  edit: (
    channelId: string,
    messageId: string,
    message: Message,
  ) => Promise<boolean>;
  remove: (channelId: string, messageId: string) => Promise<boolean>;
  direct: (userId: string, message: Message) => Promise<void>;
  exists: (channelId: string, messageId: string) => Promise<boolean>;
  findOwn: (channelId: string, content: string) => Promise<string | undefined>;
  clearReactionsExcept: (
    channelId: string,
    messageId: string,
    emojis: readonly string[],
  ) => Promise<void>;
  ownReactions: (channelId: string, messageId: string) => Promise<string[]>;
  react: (channelId: string, messageId: string, emoji: string) => Promise<void>;
}
