import { describe, expect, test } from 'bun:test';
import { createWorkspaceRefusal, revokeRefusal } from './setup-tools';

describe('create_workspace gate', () => {
  test('allows only grants that resolve workspaces created after approval', () => {
    expect(createWorkspaceRefusal({ allWorkspaces: true })).toBeNull();
    expect(createWorkspaceRefusal({ allWorkspaces: false })).toContain(
      'Allow all workspaces',
    );
  });

  test('the refusal names the two ways to gain provisioning', () => {
    const refusal = createWorkspaceRefusal({ allWorkspaces: false });
    expect(refusal).toContain('Re-approve');
    expect(refusal).toContain('Create a new workspace with this agent');
  });
});

describe('revoke_connection gate', () => {
  test('PATs always refuse: token revocation lives in Settings', () => {
    const refusal = revokeRefusal({ tokenKind: 'pat' }, true);
    expect(refusal?.code).toBe('pat_revocation_unsupported');
    expect(refusal?.message).toContain('Personal access tokens');
  });

  test('an unconfirmed call refuses and names the confirm argument', () => {
    const refusal = revokeRefusal({ tokenKind: 'oauth' }, false);
    expect(refusal?.code).toBe('confirmation_required');
    expect(refusal?.message).toContain('confirm: true');
  });

  test('a confirmed OAuth connection may revoke only itself', () => {
    expect(revokeRefusal({ tokenKind: 'oauth' }, true)).toBeNull();
  });
});
