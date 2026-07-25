interface WorkspaceIdentity {
  id: number;
  name: string;
}

interface WorkspaceStatus {
  id: number;
  onboardingCompleted: boolean;
}

export const MAX_WORKSPACES = 5;
export const WORKSPACE_LIMIT_MESSAGE = `You can have up to ${MAX_WORKSPACES} workspaces. Delete one to create another.`;

export const workspaceLimitReached = (workspaceCount: number): boolean =>
  workspaceCount >= MAX_WORKSPACES;

export type WorkspaceDeletionIssue =
  | 'not_found'
  | 'last_workspace'
  | 'confirmation_mismatch';

export const workspaceDeletionIssue = (
  owned: WorkspaceIdentity[],
  id: number,
  confirmation: string,
): WorkspaceDeletionIssue | null => {
  const workspace = owned.find((item) => item.id === id);
  if (!workspace) {
    return 'not_found';
  }
  if (owned.length === 1) {
    return 'last_workspace';
  }
  return confirmation === workspace.name ? null : 'confirmation_mismatch';
};

export const resolveWorkspaceDeletion = <T extends WorkspaceStatus>(
  workspaces: T[],
  currentId: number | null,
  lastOnboardedId: number | null,
  deletedId: number,
) => {
  const remaining = workspaces.filter(
    (workspace) => workspace.id !== deletedId,
  );
  const deletedCurrent = currentId === deletedId;
  const current =
    (deletedCurrent
      ? (remaining.find((workspace) => workspace.id === lastOnboardedId) ??
        remaining.find((workspace) => workspace.onboardingCompleted) ??
        remaining[0])
      : remaining.find((workspace) => workspace.id === currentId)) ??
    remaining[0] ??
    null;
  const lastOnboarded =
    remaining.find(
      (workspace) =>
        workspace.id === lastOnboardedId && workspace.onboardingCompleted,
    ) ??
    (current?.onboardingCompleted ? current : null) ??
    remaining.find((workspace) => workspace.onboardingCompleted) ??
    null;

  return { remaining, deletedCurrent, current, lastOnboarded };
};
