import { describe, expect, it } from 'vitest';
import { selfAssignProblem } from '~/core/roles';
import { role } from '../fakes';

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
});
