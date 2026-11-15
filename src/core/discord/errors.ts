import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { PermanentError } from '../../shared/errors.js';

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

/** Deleted or inaccessible Discord objects; retrying will not help. */
export function isPermanentDiscordError(error: unknown): boolean {
  return error instanceof DiscordAPIError && permanentCodes.has(error.code);
}

/** Rethrows permanent Discord failures as PermanentError for the scheduler. */
export function asJobError(error: unknown): unknown {
  return isPermanentDiscordError(error) && error instanceof Error
    ? new PermanentError(error.message)
    : error;
}

export function isUnknownObject(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.UnknownMessage ||
      error.code === RESTJSONErrorCodes.UnknownChannel)
  );
}
