import { describe, expect, test } from 'bun:test';
import {
  resolveWorkspaceDeletion,
  scheduledMonitoringEligible,
  workspaceDeletionIssue,
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

describe('scheduledMonitoringEligible', () => {
  const now = Date.UTC(2026, 6, 26);

  test('excludes snapshot-only workspaces from entitlement-based cron', () => {
    expect(
      scheduledMonitoringEligible(
        { monitoringTier: 'snapshot_only', monitoringEndsAt: null },
        'entitled',
        now,
      ),
    ).toBe(false);
  });

  test('fails closed for an invalid stored tier', () => {
    expect(
      scheduledMonitoringEligible(
        { monitoringTier: 'unknown', monitoringEndsAt: null },
        'entitled',
        now,
      ),
    ).toBe(false);
  });

  test('includes active pilot and subscribed workspaces', () => {
    expect(
      scheduledMonitoringEligible(
        { monitoringTier: 'pilot', monitoringEndsAt: now + 1 },
        'entitled',
        now,
      ),
    ).toBe(true);
    expect(
      scheduledMonitoringEligible(
        { monitoringTier: 'subscribed', monitoringEndsAt: null },
        'entitled',
        now,
      ),
    ).toBe(true);
  });

  test('excludes an entitlement at and after its end time', () => {
    expect(
      scheduledMonitoringEligible(
        { monitoringTier: 'pilot', monitoringEndsAt: now },
        'entitled',
        now,
      ),
    ).toBe(false);
    expect(
      scheduledMonitoringEligible(
        { monitoringTier: 'subscribed', monitoringEndsAt: now - 1 },
        'entitled',
        now,
      ),
    ).toBe(false);
  });

  test('allows every workspace under the self-hosted policy', () => {
    expect(
      scheduledMonitoringEligible(
        { monitoringTier: 'snapshot_only', monitoringEndsAt: now - 1 },
        'all',
        now,
      ),
    ).toBe(true);
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
