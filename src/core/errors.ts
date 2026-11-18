export class UserError extends Error {
  override readonly name = 'UserError';
}

export class PermanentError extends Error {
  override readonly name = 'PermanentError';
}

export const ignore = () => null;
