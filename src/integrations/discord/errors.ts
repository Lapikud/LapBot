import { PermanentError } from '~/core/errors';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';

const permanentCodes = new Set<number | string>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownGuild,
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownRole,
  RESTJSONErrorCodes.UnknownUser,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.CannotSendMessagesToThisUser,
]);

export function isPermanentDiscordError(error: unknown): boolean {
  return error instanceof DiscordAPIError && permanentCodes.has(error.code);
}

export function isUnknownObject(error: unknown): boolean {
  const source = error instanceof PermanentError ? error.cause : error;

  return (
    source instanceof DiscordAPIError &&
    (source.code === RESTJSONErrorCodes.UnknownMessage ||
      source.code === RESTJSONErrorCodes.UnknownChannel)
  );
}

export async function permanent<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (isPermanentDiscordError(error) && error instanceof Error) {
      throw new PermanentError(error.message, { cause: error });
    }

    throw error;
  }
}
