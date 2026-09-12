import { describe, expect, test } from 'bun:test';
import { connectionPropsSchema } from './connection-props';
import { MCP_SCOPE } from './constants';
import {
  generatePersonalAccessToken,
  isPersonalAccessToken,
  PAT_TOKEN_LENGTH,
  patConnectionProps,
} from './pat';

describe('personal access token format', () => {
  test('tokens are refd_ plus 43 base64url characters', () => {
    const generated = generatePersonalAccessToken();
    expect(generated.token).toMatch(/^refd_[A-Za-z0-9_-]{43}$/);
    expect(generated.token.length).toBe(PAT_TOKEN_LENGTH);
  });

  test('the display prefix exposes only the fixed prefix and a few characters', () => {
    const generated = generatePersonalAccessToken();
    expect(generated.tokenPrefix).toBe(generated.token.slice(0, 12));
    expect(generated.token.startsWith(generated.tokenPrefix)).toBe(true);
  });

  test('generation is random and yields distinct connection keys', () => {
    const first = generatePersonalAccessToken();
    const second = generatePersonalAccessToken();
    expect(first.token).not.toBe(second.token);
    expect(first.connectionKey).not.toBe(second.connectionKey);
    expect(first.connectionKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('recognizes PATs and rejects other bearer credential shapes', () => {
    const generated = generatePersonalAccessToken();
    expect(isPersonalAccessToken(generated.token)).toBe(true);
    expect(isPersonalAccessToken('refd_short')).toBe(false);
    expect(isPersonalAccessToken('other_abcd')).toBe(false);
    // Provider-issued OAuth tokens are colon-delimited internal format.
    expect(isPersonalAccessToken('1:grant:token')).toBe(false);
    expect(isPersonalAccessToken('')).toBe(false);
  });
});

describe('PAT authorization props', () => {
  test('carry the read scope, pat kind, and the row identity', () => {
    const props = patConnectionProps({
      connectionKey: crypto.randomUUID(),
      name: 'ci-agent',
      userId: 7,
      workspaceId: 11,
    });
    expect(props).toEqual({
      clientName: 'ci-agent',
      connectionId: expect.any(String),
      scopes: [MCP_SCOPE],
      tokenKind: 'pat',
      userId: 7,
      workspaceId: 11,
    });
  });

  test('validate through the shared grant-props schema', () => {
    const props = patConnectionProps({
      connectionKey: crypto.randomUUID(),
      name: 'ci-agent',
      userId: 7,
      workspaceId: 11,
    });
    expect(connectionPropsSchema.safeParse(props).success).toBeTrue();
    expect(
      connectionPropsSchema.safeParse({ ...props, tokenKind: 'oauth' }).success,
    ).toBeFalse();
    expect(
      connectionPropsSchema.safeParse({ ...props, workspaceId: -1 }).success,
    ).toBeFalse();
  });
});
