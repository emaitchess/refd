import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { WorkspaceIcon } from '@/components/layout/WorkspaceIcon';
import { useOnKeyPress } from '@/lib/keyboard';
import { cn } from '@/lib/utils';
import { useWorkspace, type Workspace } from '@/providers/workspace';

const workspaceStatus = (workspace: Workspace) =>
  workspace.onboardingCompleted ? 'ready' : 'setup required';

export const OnboardingWorkspaceMenu = ({
  disabled = false,
}: {
  disabled?: boolean;
}) => {
  const { workspaces, current, lastOnboarded, switchTo } = useWorkspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useOnKeyPress('Escape', () => setOpen(false), {
    enabled: open,
    ignoreWhenTyping: false,
  });

  const selectWorkspace = (workspace: Workspace) => {
    setOpen(false);
    switchTo(workspace.id);
    navigate(workspace.onboardingCompleted ? '/overview' : '/onboarding', {
      replace: true,
    });
  };

  if (!current) {
    return null;
  }

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 min-w-0 max-w-[170px] items-center gap-2 border border-border px-2.5 text-left transition-colors hover:bg-bg-card-hover disabled:cursor-wait disabled:opacity-60 sm:max-w-[240px]"
      >
        <WorkspaceIcon
          name={current.name}
          domain={current.brandDomain}
          size={14}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-primary">
          {current.name}
        </span>
        {!current.onboardingCompleted ? (
          <DitherIcon
            name="warning"
            size={11}
            className="shrink-0 text-warning"
          />
        ) : null}
        <span className="shrink-0 font-mono text-[9px] text-muted">▾</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            aria-label="Workspaces"
            className="absolute top-full left-1/2 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 border border-border-strong bg-bg-elevated shadow-lg"
          >
            <div className="border-border border-b px-3 py-2">
              <p className="section-label text-muted">switch workspace</p>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {workspaces.map((workspace) => {
                const active = workspace.id === current.id;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => selectWorkspace(workspace)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-card-hover',
                      active ? 'text-primary' : 'text-secondary',
                    )}
                  >
                    <WorkspaceIcon
                      name={workspace.name}
                      domain={workspace.brandDomain}
                      size={15}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {workspace.name}
                    </span>
                    {!workspace.onboardingCompleted ? (
                      <DitherIcon
                        name="warning"
                        size={11}
                        className="shrink-0 text-warning"
                      />
                    ) : null}
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[9px] uppercase tracking-[0.08em]',
                        workspace.onboardingCompleted
                          ? 'text-muted'
                          : 'text-warning',
                      )}
                    >
                      {workspaceStatus(workspace)}
                    </span>
                    {active ? (
                      <span className="shrink-0 font-mono text-[9px]">■</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {lastOnboarded && !current.onboardingCompleted ? (
              <button
                type="button"
                onClick={() => selectWorkspace(lastOnboarded)}
                className="flex w-full items-center gap-2 border-border border-t px-3 py-2 font-mono text-[10px] text-secondary transition-colors hover:bg-bg-card-hover hover:text-primary"
              >
                <DitherIcon name="arrow-left" size={11} />
                <span className="truncate">
                  return to {lastOnboarded.name} dashboard
                </span>
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
};

export const OnboardingDashboardReturn = ({
  disabled = false,
}: {
  disabled?: boolean;
}) => {
  const { current, lastOnboarded, switchTo } = useWorkspace();
  const navigate = useNavigate();

  if (!lastOnboarded || current?.onboardingCompleted) {
    return null;
  }

  return (
    <Tooltip
      asChild
      content={`Return to ${lastOnboarded.name}`}
      className="border-border-strong bg-bg-elevated text-primary shadow-lg"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          switchTo(lastOnboarded.id);
          navigate('/home', { replace: true });
        }}
        className="btn-ghost hidden h-8 max-w-48 gap-1.5 self-center px-2 font-mono text-[10px] leading-none lg:flex"
      >
        <DitherIcon name="arrow-left" size={11} />
        <span className="inline-flex h-full items-center truncate leading-none">
          back to dashboard
        </span>
      </button>
    </Tooltip>
  );
};
