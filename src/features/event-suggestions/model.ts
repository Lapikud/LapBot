export type SuggestionStatus = 'new' | 'reviewed' | 'dismissed';
export interface EventSuggestion {
  id: number;
  guildId: string;
  authorId: string;
  text: string;
  channelId: string;
  messageId: string | null;
  status: SuggestionStatus;
  createdAt: Date;
}
export interface EventSuggestionRepository {
  insert: (
    input: Pick<EventSuggestion, 'guildId' | 'authorId' | 'text' | 'channelId'>,
  ) => Promise<EventSuggestion>;
  list: (
    guildId: string,
    offset: number,
    limit: number,
  ) => Promise<EventSuggestion[]>;
  update: (
    guildId: string,
    id: number,
    changes: Partial<Pick<EventSuggestion, 'messageId' | 'status'>>,
  ) => Promise<EventSuggestion>;
}
