import {
  PermissionFlagsBits,
  PermissionsBitField,
  type Role,
} from 'discord.js';
import { pino } from 'pino';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import type { AppContext } from '~/infra/discord';
import { requireAbove, selfAssignProblem } from '~/features/roles/guards';
import {
  handleReaction,
  legacyMessage,
  legacyRoles,
} from '~/features/roles/legacy';
import {
  addPanelRole,
  createPanel,
  replacePanelRoles,
  setPanelMessage,
} from '~/features/roles/service';

function role(
  overrides: Partial<{
    id: string;
    managed: boolean;
    editable: boolean;
    permissions: bigint[];
  }> = {},
) {
  return {
    id: overrides.id ?? 'r1',
    name: 'Role',
    guild: { id: 'guild' },
    managed: overrides.managed ?? false,
    editable: overrides.editable ?? true,
    permissions: new PermissionsBitField(overrides.permissions ?? []),
  } as unknown as Role;
}

describe('legacy role mapping', () => {
  it('keeps the original message and emoji mapping', () => {
    expect(legacyMessage).toBe(
      'Valige endale rolli:\n1 - Tarkvara\n2 - Helpdesk\n3 - Kultuur',
    );
    const config = {
      TARKVARA_ROLE_ID: 't',
      HELPDESK_ROLE_ID: 'h',
      KULTUUR_ROLE_ID: 'k',
    };

    expect(legacyRoles({ config } as never)).toEqual([
      { emoji: '1️⃣', roleId: 't', label: 'Tarkvara' },
      { emoji: '2️⃣', roleId: 'h', label: 'Helpdesk' },
      { emoji: '3️⃣', roleId: 'k', label: 'Kultuur' },
    ]);
  });

  it('skips roles that are not configured', () => {
    expect(
      legacyRoles({ config: { HELPDESK_ROLE_ID: 'h' } } as never).map(
        (r) => r.label,
      ),
    ).toEqual(['Helpdesk']);
  });
});

describe('role guards', () => {
  it('accepts ordinary editable roles', () => {
    expect(selfAssignProblem(role())).toBeUndefined();
  });

  it.each([
    ['everyone', role({ id: 'guild' })],
    ['managed', role({ managed: true })],
    ['moderator', role({ permissions: [PermissionFlagsBits.BanMembers] })],
    ['above the bot', role({ editable: false })],
  ])('rejects %s roles', (_name, candidate) => {
    expect(selfAssignProblem(candidate)).toBeDefined();
  });

  it('only lets members manage roles below their highest role', () => {
    const actor = (position: number) =>
      ({
        id: 'a',
        guild: { ownerId: 'owner' },
        roles: { highest: { comparePositionTo: () => position } },
      }) as never;

    expect(() => requireAbove(actor(1), role())).not.toThrow();
    expect(() => requireAbove(actor(0), role())).toThrow(
      'not below your highest role',
    );
  });
});

describe.skipIf(noDatabase)('reaction role handling', () => {
  const guildId = snowflake();
  const channelId = snowflake();
  const messageId = snowflake();
  const roleId = snowflake();
  const add = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const assignable = role({ id: roleId });
  const guild = {
    id: guildId,
    roles: {
      fetch: vi.fn(async (id: string) => (id === roleId ? assignable : null)),
    },
    members: {
      fetch: vi.fn(async () => ({
        user: { bot: false },
        roles: { add, remove },
      })),
    },
  };
  const ctx = {
    db: noDatabase ? undefined : testDb(),
    log: pino({ level: 'silent' }),
    client: { guilds: { fetch: async () => guild } },
  } as unknown as AppContext;
  const reaction = (emoji: string, message = messageId) =>
    ({
      emoji: { name: emoji },
      message: { id: message, guildId, channelId },
    }) as never;
  const user = (bot = false) => ({ id: 'u', bot }) as never;

  beforeAll(async () => {
    const panelId = await createPanel(ctx.db, {
      guildId,
      channelId,
      kind: 'reaction',
      title: 'Legacy',
      createdBy: 'bot',
    });

    await setPanelMessage(ctx.db, panelId, messageId);
    await replacePanelRoles(ctx.db, panelId, [
      { roleId, label: 'Tarkvara', emoji: '1️⃣' },
    ]);
  });

  it('assigns and removes the mapped role', async () => {
    await handleReaction(ctx, reaction('1️⃣'), user(), true);
    expect(add).toHaveBeenCalledWith(assignable, expect.any(String));
    await handleReaction(ctx, reaction('1️⃣'), user(), false);
    expect(remove).toHaveBeenCalledWith(assignable, expect.any(String));
  });

  it('ignores reactions on unrelated messages, other emoji and bots', async () => {
    add.mockClear();
    guild.members.fetch.mockClear();
    await handleReaction(ctx, reaction('1️⃣', snowflake()), user(), true);
    await handleReaction(ctx, reaction('🎉'), user(), true);
    await handleReaction(ctx, reaction('1️⃣'), user(true), true);
    expect(add).not.toHaveBeenCalled();
    expect(guild.members.fetch).not.toHaveBeenCalled();
  });

  it('skips roles that no longer exist', async () => {
    const panelId = await createPanel(ctx.db, {
      guildId,
      channelId: snowflake(),
      kind: 'select',
      title: 'x',
      createdBy: 'u',
    });

    await addPanelRole(ctx.db, panelId, {
      roleId: 'gone',
      label: 'Gone',
      emoji: '4️⃣',
    });
    add.mockClear();
    await handleReaction(ctx, reaction('4️⃣'), user(), true);
    expect(add).not.toHaveBeenCalled();
  });
});
