import { discordAuth, type DiscordUser } from '@hono/oauth-providers/discord';
import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { Env } from './context';

export type SignIn = {
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  sessionSecret: string;
};

type SignInEnv = {
  Variables: Env['Variables'] & { 'user-discord'?: DiscordUser };
};

const sessionCookie = 'session';
const sessionSeconds = 7 * 86_400;

export async function signedInUser(
  c: Context<Env>,
  signIn: SignIn,
): Promise<string | undefined> {
  const userId = await getSignedCookie(c, signIn.sessionSecret, sessionCookie);

  return typeof userId === 'string' ? userId : undefined;
}

export function signInPages(signIn: SignIn) {
  return new Hono<SignInEnv>()
    .use(
      '/login',
      discordAuth({
        scope: ['identify'],
        client_id: signIn.clientId,
        client_secret: signIn.clientSecret,
        redirect_uri: new URL('/login', signIn.publicUrl).href,
      }),
    )
    .get('/login', async (c) => {
      const user = c.get('user-discord');

      if (!user) {
        return c.redirect('/login', 303);
      }

      await setSignedCookie(c, sessionCookie, user.id, signIn.sessionSecret, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: signIn.publicUrl.startsWith('https://'),
        path: '/',
        maxAge: sessionSeconds,
      });

      return c.redirect('/', 303);
    })
    .post('/logout', (c) => {
      deleteCookie(c, sessionCookie, { path: '/' });

      return c.redirect('/', 303);
    });
}
