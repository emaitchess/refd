import { describe, expect, test } from 'bun:test';
import { isOperatorEmail } from './operator';

describe('isOperatorEmail', () => {
  test('matches a comma-separated allowlist case-insensitively', () => {
    expect(
      isOperatorEmail(
        'admin@example.com',
        'owner@example.com, ADMIN@EXAMPLE.COM ',
      ),
    ).toBe(true);
  });

  test('requires an exact email match', () => {
    expect(
      isOperatorEmail('admin@example.com', 'admin@example.com.evil.test'),
    ).toBe(false);
    expect(
      isOperatorEmail('admin@example.com', 'other-admin@example.com'),
    ).toBe(false);
  });

  test('fails closed when configuration is absent or empty', () => {
    expect(isOperatorEmail('admin@example.com', undefined)).toBe(false);
    expect(isOperatorEmail('admin@example.com', '')).toBe(false);
  });

  test('fails closed when the allowlist exceeds its bound', () => {
    const entries = Array.from({ length: 101 }, () => 'admin@example.com').join(
      ',',
    );
    expect(isOperatorEmail('admin@example.com', entries)).toBe(false);
  });

  test('ignores malformed entries without granting access', () => {
    expect(
      isOperatorEmail(
        'admin@example.com',
        'not-an-email, admin@example.com, also-bad',
      ),
    ).toBe(true);
    expect(
      isOperatorEmail('not-an-email', 'not-an-email, admin@example.com'),
    ).toBe(false);
  });
});
