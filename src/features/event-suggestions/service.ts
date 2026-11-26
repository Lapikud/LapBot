import { requirePostable } from '~/core/helpers/posting';
import type { Actor } from '~/core/actor';
import type { Authorizer } from '~/core/ports/authorization';
import type { Directory } from '~/core/ports/directory';
import type { Messenger } from '~/core/ports/messenger';
import { UserError } from '~/core/errors';
import type { EventSuggestionRepository, SuggestionStatus } from './model';

export function createEventSuggestionService(deps: {
  suggestions: EventSuggestionRepository;
  authz: Authorizer;
  directory: Directory;
  messenger: Messenger;
}) {
  const { suggestions, authz, directory, messenger } = deps;

  return {
    suggest: async (actor: Actor, channelId: string, input: string) => {
      const text = input.trim();

      if (text.length === 0 || text.length > 1500) {
        throw new UserError('Give an idea of 1–1500 characters.');
      }

      await requirePostable(directory, actor, channelId);

      const suggestion = await suggestions.insert({
        guildId: actor.guildId,
        authorId: actor.userId,
        channelId,
        text,
      });
      let sent;

      try {
        sent = await messenger.send(channelId, {
          content: `Event suggestion from <@${actor.userId}>:\n${text}`,
        });
      } catch {
        return { suggestion, posted: false };
      }

      return {
        suggestion: await suggestions.update(actor.guildId, suggestion.id, {
          messageId: sent.messageId,
        }),
        posted: true,
      };
    },
    list: async (actor: Actor, page = 0) => {
      await authz.require(actor, 'event:suggestions:manage');
      if (!Number.isSafeInteger(page) || page < 0) {
        throw new UserError('Invalid page.');
      }

      return suggestions.list(actor.guildId, page * 25, 25);
    },
    review: async (actor: Actor, id: number, status: SuggestionStatus) => {
      await authz.require(actor, 'event:suggestions:manage');
      if (!['new', 'reviewed', 'dismissed'].includes(status)) {
        throw new UserError('Invalid status.');
      }

      return suggestions.update(actor.guildId, id, { status });
    },
  };
}

export type EventSuggestionService = ReturnType<
  typeof createEventSuggestionService
>;
