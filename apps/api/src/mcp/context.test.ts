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

  test('accepts a checked-set read grant with the default in the set', () => {
    const props = parseMcpTokenProps({
      clientName: 'Claude',
      connectionId: crypto.randomUUID(),
      scopes: [MCP_SCOPE],
      userId: 7,
      workspaceId: 2,
      workspaceIds: [2, 5],
    });
    expect(props).toMatchObject({ workspaceId: 2, workspaceIds: [2, 5] });
    expect(props?.allWorkspaces).toBeUndefined();
  });

  test('accepts an all-workspaces read grant', () => {
    const props = parseMcpTokenProps({
      clientName: 'Claude',
      connectionId: crypto.randomUUID(),
      scopes: [MCP_SCOPE],
      userId: 7,
      workspaceId: 2,
      allWorkspaces: true,
    });
    expect(props).toMatchObject({ allWorkspaces: true, workspaceId: 2 });
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

  test('rejects multi-workspace grants whose default is outside the set', () => {
    expect(
      parseMcpTokenProps({
        clientName: 'Claude',
        connectionId: crypto.randomUUID(),
        scopes: [MCP_SCOPE],
        userId: 7,
        workspaceId: 3,
        workspaceIds: [2, 5],
      }),
    ).toBeNull();
    expect(
      parseMcpTokenProps({
        clientName: 'Claude',
        connectionId: crypto.randomUUID(),
        scopes: [MCP_SCOPE],
        userId: 7,
        workspaceIds: [2, 5],
      }),
    ).toBeNull();
  });

  test('rejects a grant that is both all-workspaces and a checked set', () => {
    expect(
      parseMcpTokenProps({
        clientName: 'Claude',
        connectionId: crypto.randomUUID(),
        scopes: [MCP_SCOPE],
        userId: 7,
        workspaceId: 2,
        allWorkspaces: true,
        workspaceIds: [2, 5],
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

  test('accepts personal access token props and keeps the pat kind', () => {
    const props = {
      clientName: 'ci-agent',
      connectionId: crypto.randomUUID(),
      scopes: [MCP_SCOPE],
      tokenKind: 'pat' as const,
      userId: 7,
      workspaceId: 11,
    };
    expect(parseMcpTokenProps(props)).toMatchObject({ tokenKind: 'pat' });
    expect(
      parseMcpTokenProps({ ...props, tokenKind: 'oauth' as never }),
    ).toBeNull();
  });

  test('keeps personal access tokens single-workspace', () => {
    expect(
      parseMcpTokenProps({
        clientName: 'ci-agent',
        connectionId: crypto.randomUUID(),
        scopes: [MCP_SCOPE],
        tokenKind: 'pat',
        userId: 7,
        workspaceId: 11,
        workspaceIds: [11, 12],
      }),
    ).toBeNull();
    expect(
      parseMcpTokenProps({
        clientName: 'ci-agent',
        connectionId: crypto.randomUUID(),
        scopes: [MCP_SCOPE],
        tokenKind: 'pat',
        userId: 7,
        workspaceId: 11,
        allWorkspaces: true,
      }),
    ).toBeNull();
  });
});
