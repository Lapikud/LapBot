import type { Actor } from '~/domain';

export type WebRequest = {
  headers: Readonly<Record<string, string | undefined>>;
};

export type Authenticator = {
  authenticate: (request: WebRequest) => Promise<Actor | undefined>;
};
