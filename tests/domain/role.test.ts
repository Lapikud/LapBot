import { describe, expect, it } from 'vitest';
import { requireAbove, selfAssignProblem } from '~/domain';
import { actor, role } from '../fakes';

describe('role rules', () => {
  it('accepts ordinary assignable roles', () => {
    expect(selfAssignProblem(role())).toBeUndefined();
  });

  it.each([
    ['everyone', role({ everyone: true })],
    ['managed', role({ managed: true })],
    ['moderator', role({ moderator: true })],
    ['above the bot', role({ botCanAssign: false })],
  ])('rejects %s roles', (_name, candidate) => {
    expect(selfAssignProblem(candidate)).toBeDefined();
  });

  it('only lets members manage roles below their highest role', () => {
    expect(() =>
      requireAbove(actor({ highestRolePosition: 2 }), role({ position: 1 })),
    ).not.toThrow();
    expect(() =>
      requireAbove(actor({ highestRolePosition: 1 }), role({ position: 1 })),
    ).toThrow('not below');
    expect(() =>
      requireAbove(
        actor({ highestRolePosition: 1, owner: true }),
        role({ position: 5 }),
      ),
    ).not.toThrow();
  });
});
