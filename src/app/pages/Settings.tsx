import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { SurfaceChips } from '@/components/controls/SurfaceChips';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { useToast } from '@/components/feedback/Toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { WorkspaceIcon } from '@/components/layout/WorkspaceIcon';
import { Badge, Card, EmptyState, Modal, Skeleton } from '@/components/ui';
import { api, useAsyncAction, useQuery } from '@/lib/api';
import { useParamFlag } from '@/lib/params';
import { cn } from '@/lib/utils';
import { useWorkspace, type Workspace } from '@/providers/workspace';
import {
  limitReached,
  surfaceLimitMessage,
  workspaceLimitMessage,
} from '../../shared/config';

const WORKSPACE_GRID =
  'grid md:grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_minmax(120px,0.55fr)_minmax(190px,0.8fr)]';

const WorkspacesCard = () => {
  const {
    config,
    workspaces,
    current,
    switchTo,
    create,
    rename,
    deleteWorkspace,
  } = useWorkspace();
  const workspaceLimit = config.limits.maxWorkspaces;
  const atWorkspaceLimit = limitReached(workspaces.length, workspaceLimit);
  const workspaceLimitCopy =
    workspaceLimit === null ? null : workspaceLimitMessage(workspaceLimit);
  const navigate = useNavigate();
  const toast = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Workspace | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const { busy, error, setError, run } = useAsyncAction();
  const deleteAction = useAsyncAction();
  const newNameRef = useRef<HTMLInputElement>(null);
  useParamFlag('new-workspace', () => {
    if (!atWorkspaceLimit) {
      newNameRef.current?.focus();
    }
  });

  const cancelRename = () => {
    setEditingId(null);
    setEditName('');
    setError(null);
  };

  const saveRename = (event: FormEvent) => {
    event.preventDefault();
    if (editingId === null) {
      return;
    }
    run(async () => {
      await rename(editingId, editName.trim());
      setEditingId(null);
      setEditName('');
    });
  };

  const createWorkspace = (event: FormEvent) => {
    event.preventDefault();
    if (atWorkspaceLimit) {
      setError(workspaceLimitCopy);
      return;
    }
    run(async () => {
      await create(newName.trim());
      setNewName('');
      navigate('/onboarding');
    });
  };

  const closeDelete = () => {
    if (deleteAction.busy) {
      return;
    }
    setDeleting(null);
    setDeleteConfirmation('');
    deleteAction.setError(null);
  };

  const confirmDelete = (event: FormEvent) => {
    event.preventDefault();
    if (!deleting) {
      return;
    }
    void deleteAction.run(async () => {
      const result = await deleteWorkspace(deleting.id, deleteConfirmation);
      toast(`${deleting.name} workspace deleted`);
      setDeleting(null);
      setDeleteConfirmation('');
      if (result.deletedCurrent) {
        navigate(
          result.current.onboardingCompleted ? '/overview' : '/onboarding',
          { replace: true },
        );
      }
    });
  };

  return (
    <>
      <Card className="overflow-hidden p-0">
        <header className="border-border border-b bg-bg-elevated px-5 py-3">
          <h2 className="section-label text-primary">workspaces</h2>
          <p className="mt-1 max-w-3xl text-[12px] text-muted leading-relaxed">
            Each workspace monitors one brand with isolated competitors,
            prompts, runs, and reporting history.{' '}
            {workspaceLimit === null
              ? 'Administrator accounts have no workspace limit.'
              : `Each account can have up to ${workspaceLimit} workspaces.`}
          </p>
        </header>

        <div
          className={cn(
            WORKSPACE_GRID,
            'hidden min-h-9 items-center bg-bg-elevated md:grid',
          )}
        >
          <div className="section-label border-border border-r px-5">
            workspace
          </div>
          <div className="section-label border-border border-r px-4">
            brand domain
          </div>
          <div className="section-label border-border border-r px-4">
            status
          </div>
          <div className="section-label px-5 text-right">actions</div>
        </div>

        {workspaces.length === 0 ? (
          <div className="border-border border-t p-4">
            <EmptyState
              title="no workspaces"
              hint="Create a workspace to begin monitoring a brand."
              className="border-0"
            />
          </div>
        ) : (
          <ul>
            {workspaces.map((workspace) => {
              const isCurrent = workspace.id === current?.id;
              const status = isCurrent
                ? { tone: 'info' as const, label: 'current' }
                : workspace.onboardingCompleted
                  ? { tone: 'ok' as const, label: 'ready' }
                  : { tone: 'neutral' as const, label: 'setup required' };

              return (
                <li key={workspace.id} className="border-border border-t">
                  {editingId === workspace.id ? (
                    <form
                      onSubmit={saveRename}
                      className={cn(WORKSPACE_GRID, 'md:min-h-14')}
                    >
                      <div className="flex items-center gap-2 px-5 py-3 md:border-border md:border-r">
                        <WorkspaceIcon
                          name={workspace.name}
                          domain={workspace.brandDomain}
                          size={18}
                        />
                        <input
                          className="input h-8 min-w-0 flex-1"
                          aria-label={`Rename ${workspace.name}`}
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          minLength={1}
                          maxLength={60}
                          required
                          autoFocus
                        />
                      </div>
                      <div className="flex items-center border-border border-t px-5 py-2 font-mono text-[11px] text-muted md:border-t-0 md:border-r md:px-4">
                        {workspace.brandDomain ?? 'not configured'}
                      </div>
                      <div className="flex items-center border-border border-t px-5 py-2 md:border-t-0 md:border-r md:px-4">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <div className="flex items-center justify-end gap-1 border-border border-t px-5 py-2 md:border-t-0">
                        <button
                          type="button"
                          className="btn-ghost h-7 px-2 font-mono text-[11px]"
                          onClick={cancelRename}
                        >
                          cancel
                        </button>
                        <button
                          type="submit"
                          className="btn-secondary h-7 px-2"
                          disabled={busy}
                        >
                          {busy ? 'saving…' : 'save'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className={cn(WORKSPACE_GRID, 'md:min-h-14')}>
                      <div className="flex min-w-0 items-center gap-2 px-5 py-3 md:border-border md:border-r">
                        <WorkspaceIcon
                          name={workspace.name}
                          domain={workspace.brandDomain}
                          size={18}
                        />
                        <span className="truncate text-[13px] text-primary">
                          {workspace.name}
                        </span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2 border-border border-t px-5 py-2 md:border-t-0 md:border-r md:px-4">
                        <span className="field-label md:hidden">brand</span>
                        <span className="truncate font-mono text-[11px] text-muted">
                          {workspace.brandDomain ?? 'not configured'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 border-border border-t px-5 py-2 md:border-t-0 md:border-r md:px-4">
                        <span className="field-label md:hidden">status</span>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <div className="flex items-center justify-end gap-1 border-border border-t px-5 py-2 md:border-t-0">
                        {!isCurrent ? (
                          <button
                            type="button"
                            className="btn-ghost h-7 px-2 font-mono text-[11px]"
                            onClick={() => {
                              switchTo(workspace.id);
                              if (!workspace.onboardingCompleted) {
                                navigate('/onboarding');
                              }
                            }}
                          >
                            switch
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-ghost h-7 px-2 font-mono text-[11px]"
                          onClick={() => {
                            setEditingId(workspace.id);
                            setEditName(workspace.name);
                            setError(null);
                          }}
                        >
                          rename
                        </button>
                        <Tooltip
                          content="At least one workspace is required"
                          disabled={workspaces.length > 1}
                          className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                        >
                          <button
                            type="button"
                            className="btn-ghost h-7 gap-1 px-2 font-mono text-[11px] text-error disabled:cursor-not-allowed disabled:text-muted disabled:opacity-50"
                            disabled={workspaces.length === 1}
                            onClick={() => {
                              setDeleting(workspace);
                              setDeleteConfirmation('');
                              deleteAction.setError(null);
                            }}
                          >
                            <DitherIcon name="trash" size={11} />
                            delete
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={createWorkspace}
          className="flex flex-col gap-3 border-border border-t px-5 py-4 md:flex-row md:items-end md:justify-between"
        >
          <div>
            <label htmlFor="new-workspace" className="field-label">
              create workspace
            </label>
            <p className="mt-1 text-[12px] text-muted">
              {atWorkspaceLimit
                ? workspaceLimitCopy
                : 'Creating one switches to its onboarding flow immediately.'}
            </p>
          </div>
          <div className="flex min-w-0 gap-2 md:w-[420px]">
            <input
              id="new-workspace"
              ref={newNameRef}
              className="input h-9 min-w-0 flex-1"
              placeholder="workspace name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              minLength={1}
              maxLength={60}
              required
              disabled={atWorkspaceLimit}
            />
            <button
              type="submit"
              className="btn-secondary"
              disabled={busy || atWorkspaceLimit}
            >
              {busy ? 'creating…' : 'create'}
            </button>
          </div>
        </form>
        {error ? (
          <p className="border-border border-t px-5 py-3 text-[13px] text-error">
            {error}
          </p>
        ) : null}
      </Card>

      {deleting ? (
        <Modal title={`Delete ${deleting.name}?`} onClose={closeDelete}>
          <form onSubmit={confirmDelete}>
            <p className="text-[13px] text-secondary leading-relaxed">
              This permanently deletes the workspace, its prompts, competitors,
              runs, reports, and stored raw answers. This cannot be undone.
            </p>
            <label className="mt-4 flex flex-col gap-1.5">
              <span className="field-label">
                type “{deleting.name}” to confirm
              </span>
              <input
                className="input h-9"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                required
                autoComplete="off"
                autoFocus
              />
            </label>
            {deleteAction.error ? (
              <p className="mt-3 text-[13px] text-error" aria-live="polite">
                {deleteAction.error}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeDelete}
                disabled={deleteAction.busy}
              >
                cancel
              </button>
              <button
                type="submit"
                className="btn-secondary text-error"
                disabled={
                  deleteAction.busy || deleteConfirmation !== deleting.name
                }
              >
                {deleteAction.busy ? 'deleting…' : 'delete permanently'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
};

const SurfacesCard = () => {
  const query = useQuery<{ surfaces: string[] }>('/settings');
  const [override, setOverride] = useState<string[] | null>(null);
  const selected = override ?? query.data?.surfaces ?? [];
  const toast = useToast();
  const { config } = useWorkspace();
  const surfaceLimit = config.limits.maxEnabledSurfacesPerWorkspace;
  const { busy, error, run } = useAsyncAction();

  const change = (next: string[]) => {
    const previous = selected;
    setOverride(next);
    void run(async () => {
      try {
        await api('/settings', {
          method: 'PATCH',
          body: JSON.stringify({ surfaces: next }),
        });
        toast('tracked AI surfaces updated');
      } catch (cause) {
        setOverride(previous);
        throw cause;
      }
    });
  };

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <header className="flex min-h-24 flex-col justify-center border-border border-b bg-bg-elevated px-5 py-3">
        <h2 className="section-label text-primary">tracked AI surfaces</h2>
        <p className="mt-1 text-[12px] text-muted leading-relaxed">
          Every active prompt runs across these surfaces. Fewer surfaces reduce
          provider usage and cost.
        </p>
      </header>
      <div className="flex flex-1 flex-col justify-between gap-5 p-5">
        {query.loading && !query.data ? (
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-8 w-28" />
            ))}
          </div>
        ) : !query.data && query.error ? (
          <EmptyState
            title="surfaces unavailable"
            hint="Tracked AI surfaces could not be loaded."
            action={
              <button
                type="button"
                className="btn-secondary"
                onClick={query.refetch}
              >
                retry
              </button>
            }
            className="border-0"
          />
        ) : (
          <SurfaceChips
            selected={selected}
            onChange={change}
            disabled={busy}
            maxSelected={surfaceLimit}
            onLimitReached={() => toast(surfaceLimitMessage(surfaceLimit))}
            surfaces={config.availableSurfaces}
          />
        )}
        <p className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
          Keep at least one surface enabled. You can select up to {surfaceLimit}
          .
        </p>
      </div>
      <div className="flex min-h-10 items-center justify-between gap-3 border-border border-t px-5 py-2">
        <span className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
          {selected.length} of {surfaceLimit} allowed
        </span>
        {busy ? (
          <span className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">
            saving
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="border-border border-t px-5 py-3 text-[13px] text-error">
          {error}
        </p>
      ) : null}
    </Card>
  );
};

// Layer 5 operator lever: queue-driven backfill rescore. Deliberately gated
// to dev builds until it grows an admin surface — rewriting historical
// scores is an operator action, not a user feature.
const RescoreCard = () => {
  const query = useQuery<{
    scoringVersion: number;
    total: number;
    stale: number;
  }>('/runs/rescore');
  const toast = useToast();
  const { busy, error, run } = useAsyncAction();
  const [draining, setDraining] = useState(false);
  const stale = query.data?.stale ?? 0;
  const { refetch } = query;

  useEffect(() => {
    if (!draining) {
      return;
    }
    if (query.data?.stale === 0) {
      setDraining(false);
      toast('backfill rescore complete');
      return;
    }
    const timer = setInterval(refetch, 2000);
    return () => clearInterval(timer);
  }, [draining, query.data?.stale, refetch, toast]);

  const start = () => {
    void run(async () => {
      const res = await api<{ started: boolean; stale: number }>(
        '/runs/rescore',
        { method: 'POST' },
      );
      if (res.started) {
        setDraining(true);
      } else {
        toast('nothing to rescore');
      }
      refetch();
    });
  };

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <header className="flex min-h-24 flex-col justify-center border-border border-b bg-bg-elevated px-5 py-3">
        <h2 className="section-label text-primary">scoring backfill</h2>
        <p className="mt-1 text-[12px] text-muted leading-relaxed">
          Replays stored raw answers through the current scorer. Internal tool,
          visible in dev builds only.
        </p>
      </header>
      <div className="flex items-center justify-between gap-3 p-5">
        <span className="font-mono text-[12px] text-secondary">
          {query.loading && !query.data
            ? 'loading'
            : `${stale} of ${query.data?.total ?? 0} stored results below scoring v${query.data?.scoringVersion ?? '?'}`}
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={start}
          disabled={busy || draining || stale === 0}
        >
          {draining ? 'rescoring' : 'backfill rescore'}
        </button>
      </div>
      {error ? (
        <p className="border-border border-t px-5 py-3 text-[13px] text-error">
          {error}
        </p>
      ) : null}
    </Card>
  );
};

export const Settings = () => (
  <>
    <PageHeader
      title="Settings"
      description="Manage workspaces and the AI surfaces monitored in each run."
    />

    <div className="flex flex-col gap-4">
      <WorkspacesCard />
      <SurfacesCard />
      {import.meta.env.DEV ? <RescoreCard /> : null}
    </div>
  </>
);
