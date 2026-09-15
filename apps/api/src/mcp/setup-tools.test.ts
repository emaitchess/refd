import { describe, expect, test } from 'bun:test';
import { createWorkspaceRefusal } from './setup-tools';

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
