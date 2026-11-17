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
  return (
    error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.UnknownMessage ||
      error.code === RESTJSONErrorCodes.UnknownChannel)
  );
}

export async function permanent<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (isPermanentDiscordError(error) && error instanceof Error) {
      throw new PermanentError(error.message);
    }

    throw error;
  }
}
