import type { Authenticator } from '~/core/ports';
import type { Actor } from '~/domain';

export function localOperator(actor: () => Promise<Actor>): Authenticator {
  return { authenticate: actor };
}
