interface WorkspaceIdentity {
  id: number;
  name: string;
}

interface WorkspaceStatus {
  id: number;
  onboardingCompleted: boolean;
}

export const MONITORING_TIERS = [
  'snapshot_only',
  'pilot',
  'subscribed',
] as const;
export type MonitoringTier = (typeof MONITORING_TIERS)[number];
export type ScheduledMonitoringPolicy = 'entitled' | 'all';

interface MonitoringAccess {
  monitoringTier: string;
  monitoringEndsAt: number | null;
}

export const scheduledMonitoringEligible = (
  workspace: MonitoringAccess,
  policy: ScheduledMonitoringPolicy,
  at: number,
): boolean => {
  if (policy === 'all') {
    return true;
  }
  if (
    workspace.monitoringTier !== 'pilot' &&
    workspace.monitoringTier !== 'subscribed'
  ) {
    return false;
  }
  return workspace.monitoringEndsAt === null || workspace.monitoringEndsAt > at;
};

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
