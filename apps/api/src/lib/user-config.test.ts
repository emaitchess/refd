import { describe, expect, test } from 'bun:test';
import { configForUser } from './user-config';

describe('configForUser', () => {
  test('grants administrator limits only to an allowlisted email', () => {
    expect(
      configForUser('owner@example.com', 'ops@example.com, owner@example.com')
        .isAdmin,
    ).toBe(true);
    expect(
      configForUser('member@example.com', 'ops@example.com, owner@example.com')
        .isAdmin,
    ).toBe(false);
  });
});
