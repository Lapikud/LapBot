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
