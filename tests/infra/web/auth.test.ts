import { describe, expect, it, vi } from 'vitest';
import { createDiscordOAuth } from '~/infra/web';
import { actor, fakeDirectory } from '../../fakes';

describe('Discord OAuth adapter', () => {
  it('builds an authorize URL and turns a code into a guild actor', async () => {
    const directory = fakeDirectory();
    const member = actor({ userId: '42' });

    directory.member.mockResolvedValue(member);

    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: 't', token_type: 'Bearer' }),
      )
      .mockResolvedValueOnce(Response.json({ id: '42' }));
    const oauth = createDiscordOAuth({
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'http://localhost/cb',
      guildId: 'g',
      directory,
      fetch,
    });

    expect(oauth.authorizeUrl('state')).toContain('scope=identify');
    expect(await oauth.actorFor('code')).toBe(member);
    expect(directory.member).toHaveBeenCalledWith('g', '42');
  });

  it('returns nothing when Discord rejects the code', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ error: 'invalid_grant' }, { status: 400 }),
      );
    const oauth = createDiscordOAuth({
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'r',
      guildId: 'g',
      directory: fakeDirectory(),
      fetch,
    });

    expect(await oauth.actorFor('bad')).toBeUndefined();
  });
});
