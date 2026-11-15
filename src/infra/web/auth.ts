import { z } from 'zod';
import type { Authenticator, Directory } from '~/core/ports';
import type { Actor } from '~/domain';

export function localOperator(actor: () => Promise<Actor>): Authenticator {
  return { authenticate: actor };
}

const tokenResponse = z.object({
  access_token: z.string(),
  token_type: z.string(),
});
const userResponse = z.object({ id: z.string() });
const discordApi = 'https://discord.com/api/v10';

export type DiscordOAuthOptions = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  guildId: string;
  directory: Directory;
  fetch?: typeof fetch;
};

export function createDiscordOAuth(options: DiscordOAuthOptions) {
  const request = options.fetch ?? fetch;

  return {
    authorizeUrl: (state: string) => {
      const url = new URL('https://discord.com/oauth2/authorize');

      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        response_type: 'code',
        scope: 'identify',
        state,
      }).toString();

      return url.href;
    },
    actorFor: async (code: string): Promise<Actor | undefined> => {
      const token = await request(`${discordApi}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: options.redirectUri,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const parsedToken = tokenResponse.safeParse(
        await token.json().catch(() => null),
      );

      if (!token.ok || !parsedToken.success) {
        return undefined;
      }

      const me = await request(`${discordApi}/users/@me`, {
        headers: {
          Authorization: `${parsedToken.data.token_type} ${parsedToken.data.access_token}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      const parsedUser = userResponse.safeParse(
        await me.json().catch(() => null),
      );

      if (!me.ok || !parsedUser.success) {
        return undefined;
      }

      return options.directory.member(options.guildId, parsedUser.data.id);
    },
  };
}
