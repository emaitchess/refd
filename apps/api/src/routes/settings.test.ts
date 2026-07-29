import { describe, expect, test } from 'bun:test';
import { isStaleConnection, RECONCILE_GRACE_MS } from './settings';

const now = 1_800_000_000_000;
const active = new Set(['live-grant']);

describe('isStaleConnection', () => {
  test('a fresh row with a missing grant is NOT stale (KV list lag guard)', () => {
    // The grant may simply not be visible yet in the eventually-consistent
    // OAUTH_KV list; within the grace window we never revoke it.
    const row = { grantId: 'just-created', createdAt: now - 8_000 };
    expect(isStaleConnection(row, active, now)).toBe(false);
  });

  test('an aged row with a missing grant IS stale', () => {
    const row = { grantId: 'gone', createdAt: now - RECONCILE_GRACE_MS - 1 };
    expect(isStaleConnection(row, active, now)).toBe(true);
  });

  test('a row whose grant is still active is never stale, at any age', () => {
    expect(
      isStaleConnection({ grantId: 'live-grant', createdAt: 0 }, active, now),
    ).toBe(false);
    expect(
      isStaleConnection(
        { grantId: 'live-grant', createdAt: now - 5_000 },
        active,
        now,
      ),
    ).toBe(false);
  });

  test('exactly at the grace boundary is not yet stale (strictly greater)', () => {
    const row = { grantId: 'gone', createdAt: now - RECONCILE_GRACE_MS };
    expect(isStaleConnection(row, active, now)).toBe(false);
  });
});
