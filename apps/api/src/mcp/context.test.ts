import { describe, expect, test } from 'bun:test';
import { MCP_SCOPE } from '../oauth/constants';
import { parseMcpTokenProps } from './context';

describe('MCP authorization context', () => {
  test('accepts one validated read-only workspace grant', () => {
    expect(
      parseMcpTokenProps({
        callbackTarget: 'https://claude.ai',
        clientName: 'Claude',
        connectionId: crypto.randomUUID(),
        scopes: [MCP_SCOPE],
        userId: 7,
        workspaceId: 11,
      }),
    ).toMatchObject({
      callbackTarget: 'https://claude.ai',
      clientName: 'Claude',
      scopes: [MCP_SCOPE],
      userId: 7,
      workspaceId: 11,
    });
  });

  test('rejects malformed, expanded, and unscoped grants', () => {
    expect(
      parseMcpTokenProps({
        clientName: 'Claude',
        connectionId: crypto.randomUUID(),
        scopes: [MCP_SCOPE, MCP_SCOPE],
        userId: 7,
        workspaceId: 11,
      }),
    ).toBeNull();
    expect(
      parseMcpTokenProps({
        clientName: 'Claude',
        connectionId: crypto.randomUUID(),
        scopes: [],
        userId: 7,
        workspaceId: 11,
      }),
    ).toBeNull();
    expect(
      parseMcpTokenProps({
        clientName: 'Claude',
        connectionId: crypto.randomUUID(),
        scopes: [MCP_SCOPE],
        userId: 7,
        workspaceId: -1,
      }),
    ).toBeNull();
  });

  test('accepts grants created before callback targets were persisted', () => {
    expect(
      parseMcpTokenProps({
        clientName: 'Legacy client',
        connectionId: crypto.randomUUID(),
        scopes: [MCP_SCOPE],
        userId: 7,
        workspaceId: 11,
      }),
    ).not.toBeNull();
  });
});
