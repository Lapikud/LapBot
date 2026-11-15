/**
 * An expected failure caused by user input or current state. Its message is
 * safe to show to the user and it is not logged as an error.
 */
export class UserError extends Error {
  override readonly name = 'UserError';
}

/** A job failure that retrying cannot fix. */
export class PermanentError extends Error {
  override readonly name = 'PermanentError';
}

/** For best-effort calls whose failure needs no handling, e.g. a late reply. */
export function ignore(): void {
  // Intentionally empty.
}
