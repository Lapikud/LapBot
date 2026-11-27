import { discordAuth, type DiscordUser } from '@hono/oauth-providers/discord';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import type { Env } from './context';

export interface SignIn {
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  sessionSecret: string;
}

interface SignInEnv {
  Variables: Env['Variables'] & { 'user-discord'?: DiscordUser };
}

const sessionCookie = 'session';
const sessionSeconds = 7 * 86_400;

export async function signedInUser(
  c: Context<Env>,
  signIn: SignIn,
): Promise<string | undefined> {
  const token = getCookie(c, sessionCookie);

  if (token === undefined) {
    return undefined;
  }

  const { sub } = await verify(token, signIn.sessionSecret, 'HS256').catch(
    () => ({ sub: undefined }),
  );

  return typeof sub === 'string' ? sub : undefined;
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

      setCookie(
        c,
        sessionCookie,
        await sign(
          {
            sub: user.id,
            exp: Math.floor(Date.now() / 1000) + sessionSeconds,
          },
          signIn.sessionSecret,
        ),
        {
          httpOnly: true,
          sameSite: 'Lax',
          secure: signIn.publicUrl.startsWith('https://'),
          path: '/',
          maxAge: sessionSeconds,
        },
      );

      return c.redirect('/', 303);
    })
    .post('/logout', (c) => {
      deleteCookie(c, sessionCookie, { path: '/' });

      return c.redirect('/', 303);
    });
}
