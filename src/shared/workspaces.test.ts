import { describe, expect, test } from 'bun:test';
import {
  MAX_WORKSPACES,
  resolveWorkspaceDeletion,
  workspaceDeletionIssue,
  workspaceLimitReached,
} from './workspaces';

const ready = (id: number, name: string) => ({
  id,
  name,
  onboardingCompleted: true,
});
const incomplete = (id: number, name: string) => ({
  id,
  name,
  onboardingCompleted: false,
});

describe('workspaceLimitReached', () => {
  test('allows creation below the limit', () => {
    expect(workspaceLimitReached(MAX_WORKSPACES - 1)).toBe(false);
  });

  test('blocks creation at and above the limit', () => {
    expect(workspaceLimitReached(MAX_WORKSPACES)).toBe(true);
    expect(workspaceLimitReached(MAX_WORKSPACES + 1)).toBe(true);
  });
});

describe('workspaceDeletionIssue', () => {
  const owned = [ready(1, 'Alpha'), incomplete(2, 'Beta')];

  test('rejects a workspace the user does not own', () => {
    expect(workspaceDeletionIssue(owned, 3, 'Gamma')).toBe('not_found');
  });

  test('protects the only remaining workspace', () => {
    expect(workspaceDeletionIssue([ready(1, 'Alpha')], 1, 'Alpha')).toBe(
      'last_workspace',
    );
  });

  test('requires the exact workspace name', () => {
    expect(workspaceDeletionIssue(owned, 2, 'beta')).toBe(
      'confirmation_mismatch',
    );
    expect(workspaceDeletionIssue(owned, 2, 'Beta')).toBeNull();
  });
});

describe('resolveWorkspaceDeletion', () => {
  test('returns to the last completed workspace after deleting the active one', () => {
    const result = resolveWorkspaceDeletion(
      [ready(1, 'Alpha'), incomplete(2, 'Beta'), ready(3, 'Gamma')],
      2,
      3,
      2,
    );

    expect(result.deletedCurrent).toBe(true);
    expect(result.current?.id).toBe(3);
    expect(result.lastOnboarded?.id).toBe(3);
  });

  test('chooses another completed workspace when the remembered one is deleted', () => {
    const result = resolveWorkspaceDeletion(
      [ready(1, 'Alpha'), ready(2, 'Beta'), incomplete(3, 'Gamma')],
      2,
      2,
      2,
    );

    expect(result.current?.id).toBe(1);
    expect(result.lastOnboarded?.id).toBe(1);
  });

  test('keeps the active workspace when deleting a different workspace', () => {
    const result = resolveWorkspaceDeletion(
      [ready(1, 'Alpha'), ready(2, 'Beta'), incomplete(3, 'Gamma')],
      1,
      2,
      2,
    );

    expect(result.deletedCurrent).toBe(false);
    expect(result.current?.id).toBe(1);
    expect(result.lastOnboarded?.id).toBe(1);
  });

  test('falls back to incomplete setup when no completed workspace remains', () => {
    const result = resolveWorkspaceDeletion(
      [ready(1, 'Alpha'), incomplete(2, 'Beta')],
      1,
      1,
      1,
    );

    expect(result.current?.id).toBe(2);
    expect(result.current?.onboardingCompleted).toBe(false);
    expect(result.lastOnboarded).toBeNull();
  });
});
