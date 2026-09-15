import {
  limitReached,
  surfaceLimitMessage,
  workspaceLimitMessage,
} from '@refd/core/config';
import {
  nextOccurrenceDates,
  type RunSchedule,
  SCHEDULE_WEEKDAYS,
  scheduledTimeMs,
  WEEKLY_INTERVAL_MAX,
} from '@refd/core/schedule';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Select } from '@/components/controls/Select';
import { SurfaceChips } from '@/components/controls/SurfaceChips';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { useToast } from '@/components/feedback/Toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { WorkspaceIcon } from '@/components/layout/WorkspaceIcon';
import { Badge, Card, EmptyState, Modal, Skeleton } from '@/components/ui';
import { api, useAsyncAction, useQuery } from '@/lib/api';
import { callbackHint } from '@/lib/callback-hint';
import { timestamp } from '@/lib/format';
import { useParamFlag } from '@/lib/params';
import { cn } from '@/lib/utils';
import { useWorkspace, type Workspace } from '@/providers/workspace';

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

const MINUTE_OPTIONS = ['00', '15', '30', '45'];

const timeLabel = (schedule: RunSchedule): string =>
  `${String(schedule.hourUtc).padStart(2, '0')}:${String(
    schedule.minuteUtc,
  ).padStart(2, '0')}`;

const scheduleSummary = (schedule: RunSchedule): string => {
  const time = `${timeLabel(schedule)} UTC`;
  if (schedule.kind === 'daily') {
    return `Every day at ${time}`;
  }
  const days = schedule.days.map((day) => SCHEDULE_WEEKDAYS[day]).join(', ');
  const every =
    schedule.interval === 1 ? '' : `, every ${schedule.interval} weeks`;
  return `${days} at ${time}${every}`;
};

const occurrenceLabel = (schedule: RunSchedule, date: string): string => {
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(scheduledTimeMs(schedule, date));
  return `${day}, ${timeLabel(schedule)} UTC`;
};

const localOccurrenceLabel = (schedule: RunSchedule, date: string): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(scheduledTimeMs(schedule, date));

const pad2 = (value: number): string => String(value).padStart(2, '0');

const ScheduleDialog = ({
  schedule,
  scheduleActive,
  onClose,
  onSaved,
}: {
  schedule: RunSchedule;
  scheduleActive: boolean;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [draft, setDraft] = useState<RunSchedule>(schedule);
  const { busy, error, run } = useAsyncAction();
  const toast = useToast();
  const weeklyWithoutDays = draft.kind === 'weekly' && draft.days.length === 0;
  const [next, after] = nextOccurrenceDates(draft, Date.now(), 2);

  const toggleDay = (day: number) => {
    const days = draft.days.includes(day)
      ? draft.days.filter((value) => value !== day)
      : [...draft.days, day].sort((a, b) => a - b);
    setDraft({ ...draft, days });
  };

  const save = () => {
    if (weeklyWithoutDays) {
      return;
    }
    void run(async () => {
      await api<{ schedule: RunSchedule }>('/settings/schedule', {
        method: 'PATCH',
        body: JSON.stringify(draft),
      });
      onSaved();
      toast('run schedule updated');
      onClose();
    });
  };

  return (
    <Modal title="Run schedule" onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-primary">Automatic runs</p>
          <p className="mt-0.5 max-w-[16rem] text-[12px] text-muted leading-relaxed">
            {scheduleActive
              ? 'Scheduled runs fire at the times configured below.'
              : 'This workspace has no active monitoring plan, so scheduled runs stay paused regardless of this setting.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label="Automatic runs"
          disabled={busy}
          onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
          className={cn(
            'relative mt-0.5 h-5 w-9 shrink-0 border transition-colors duration-150',
            draft.enabled
              ? 'border-border-strong bg-accent-soft'
              : 'border-border bg-bg',
          )}
        >
          <span
            className={cn(
              'absolute top-[3px] h-3 w-3 bg-primary transition-all duration-150',
              draft.enabled ? 'left-[19px]' : 'left-[3px]',
            )}
          />
        </button>
      </div>

      {draft.enabled ? (
        <>
          <div className="mt-4 flex items-center justify-between border-border border-b py-3">
            <span className="text-[13px] text-primary">Frequency</span>
            <div className="flex border border-border">
              {(['daily', 'weekly'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={cn(
                    'h-8 px-4 text-[13px] capitalize transition-colors duration-150',
                    draft.kind === kind
                      ? 'bg-accent-soft text-primary'
                      : 'text-secondary hover:text-primary',
                  )}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      kind,
                      ...(kind === 'daily'
                        ? { interval: 1, days: [] }
                        : {
                            interval: draft.interval,
                            days: draft.days.length > 0 ? draft.days : [1],
                          }),
                    })
                  }
                >
                  {kind}
                </button>
              ))}
            </div>
          </div>

          {draft.kind === 'weekly' ? (
            <>
              <div className="border-border border-b py-3">
                <p className="field-label">days</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {SCHEDULE_WEEKDAYS.map((label, day) => {
                    const selected = draft.days.includes(day);
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={selected}
                        disabled={busy}
                        className={cn(
                          'h-8 border px-3 text-[13px] transition-colors duration-150',
                          selected
                            ? 'border-border-strong bg-accent-soft text-primary'
                            : 'border-border text-secondary hover:text-primary',
                        )}
                        onClick={() => toggleDay(day)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {weeklyWithoutDays ? (
                  <p className="mt-2 text-[12px] text-error">
                    Pick at least one day.
                  </p>
                ) : null}
              </div>
              <div className="flex items-center justify-between border-border border-b py-3">
                <span className="text-[13px] text-primary">Repeat every</span>
                <div className="flex items-center gap-2">
                  <div className="flex border border-border">
                    <button
                      type="button"
                      aria-label="Fewer weeks between runs"
                      disabled={busy || draft.interval <= 1}
                      className="h-8 w-8 text-[13px] text-secondary transition-colors duration-150 hover:text-primary disabled:opacity-50"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          interval: Math.max(1, draft.interval - 1),
                        })
                      }
                    >
                      −
                    </button>
                    <span className="flex h-8 w-10 items-center justify-center border-border border-x font-mono text-[13px] text-primary">
                      {draft.interval}
                    </span>
                    <button
                      type="button"
                      aria-label="More weeks between runs"
                      disabled={busy || draft.interval >= WEEKLY_INTERVAL_MAX}
                      className="h-8 w-8 text-[13px] text-secondary transition-colors duration-150 hover:text-primary disabled:opacity-50"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          interval: Math.min(
                            WEEKLY_INTERVAL_MAX,
                            draft.interval + 1,
                          ),
                        })
                      }
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[13px] text-secondary">
                    {draft.interval === 1 ? 'week' : 'weeks'}
                  </span>
                </div>
              </div>
            </>
          ) : null}

          <div className="flex items-center justify-between border-border border-b py-3">
            <span className="text-[13px] text-primary">Time (UTC)</span>
            <div className="flex items-center gap-1.5">
              <Select
                ariaLabel="Hour (UTC)"
                size="sm"
                className="w-16"
                position="fixed"
                value={pad2(draft.hourUtc)}
                options={Array.from({ length: 24 }, (_, hour) => pad2(hour))}
                onChange={(value) =>
                  setDraft({ ...draft, hourUtc: Number.parseInt(value, 10) })
                }
              />
              <span className="text-[13px] text-muted">:</span>
              <Select
                ariaLabel="Minute (UTC)"
                size="sm"
                className="w-16"
                position="fixed"
                value={pad2(draft.minuteUtc)}
                options={MINUTE_OPTIONS}
                onChange={(value) =>
                  setDraft({ ...draft, minuteUtc: Number.parseInt(value, 10) })
                }
              />
            </div>
          </div>

          <div className="py-3">
            <div className="flex items-baseline justify-between gap-4 py-0.5">
              <span className="field-label">next run</span>
              <span className="text-right font-mono text-[12px] text-secondary">
                {next
                  ? `${occurrenceLabel(draft, next)} (${localOccurrenceLabel(draft, next)} local)`
                  : '—'}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-0.5">
              <span className="field-label">then</span>
              <span className="text-right font-mono text-[12px] text-secondary">
                {after ? occurrenceLabel(draft, after) : '—'}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="mt-4 border-border border-b py-3">
          <p className="text-[12px] text-muted leading-relaxed">
            Scheduled runs are off for this workspace. Turn them on to pick a
            frequency, days, and time.
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        {error ? (
          <p className="mr-auto text-[13px] text-error" aria-live="polite">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={save}
          disabled={busy || weeklyWithoutDays}
        >
          {busy ? 'saving…' : 'save schedule'}
        </button>
      </div>
    </Modal>
  );
};

const ScheduleCard = () => {
  const query = useQuery<{ schedule: RunSchedule; scheduleActive: boolean }>(
    '/settings',
  );
  const [editing, setEditing] = useState(false);
  // Deep link (?schedule=1, e.g. from the command palette) opens the dialog;
  // it renders once the query lands.
  useParamFlag('schedule', () => setEditing(true));
  const schedule = query.data?.schedule ?? null;
  const scheduleActive = query.data?.scheduleActive ?? false;
  const [next] = schedule ? nextOccurrenceDates(schedule, Date.now(), 1) : [];

  return (
    <>
      <Card className="flex flex-col overflow-hidden p-0">
        <header className="flex min-h-24 flex-col justify-center border-border border-b bg-bg-elevated px-5 py-3">
          <h2 className="section-label text-primary">run schedule</h2>
          <p className="mt-1 text-[12px] text-muted leading-relaxed">
            When this workspace&apos;s scheduled runs fire. Every active prompt
            runs at once, so fewer runs mean lower provider usage and cost.
          </p>
        </header>
        {query.loading && !query.data ? (
          <div className="p-5">
            <Skeleton className="h-6 w-64" />
          </div>
        ) : !schedule ? (
          <EmptyState
            title="schedule unavailable"
            hint="The run schedule could not be loaded."
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
          <div className="flex flex-col justify-between gap-3 p-5 md:flex-row md:items-center">
            <div className="min-w-0">
              <p className="text-[13px] text-primary">
                {schedule.enabled
                  ? scheduleSummary(schedule)
                  : 'Automatic runs are off'}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted uppercase tracking-[0.08em]">
                {!scheduleActive
                  ? 'paused: no active monitoring plan'
                  : schedule.enabled && next
                    ? `next run ${occurrenceLabel(schedule, next)}`
                    : 'next run —'}
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary shrink-0 md:ml-4"
              onClick={() => setEditing(true)}
            >
              edit schedule
            </button>
          </div>
        )}
      </Card>

      {editing && schedule ? (
        <ScheduleDialog
          schedule={schedule}
          scheduleActive={scheduleActive}
          onClose={() => setEditing(false)}
          onSaved={query.refetch}
        />
      ) : null}
    </>
  );
};

interface ConnectedApp {
  id: number;
  clientName: string;
  callbackTarget: string | null;
  scopes: string[];
  allWorkspaces: boolean;
  workspaceId: number;
  workspaceName: string | null;
  workspaceCount: number;
  createdAt: number;
  lastUsedAt: number | null;
}

interface TokenRecord {
  id: number;
  name: string;
  tokenPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const TOKEN_GRID =
  'grid md:grid-cols-[minmax(180px,1fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(90px,0.4fr)]';

const TokensCard = () => {
  const query = useQuery<{ tokens: TokenRecord[] }>('/settings/tokens');
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<TokenRecord | null>(null);
  const [token, setToken] = useState('');
  const [revoking, setRevoking] = useState<TokenRecord | null>(null);
  const { busy, error, run } = useAsyncAction();
  const action = useAsyncAction();
  const toast = useToast();

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    run(async () => {
      const result = await api<{ token: string; record: TokenRecord }>(
        '/settings/tokens',
        { method: 'POST', body: JSON.stringify({ name: name.trim() }) },
      );
      setName('');
      setToken(result.token);
      setIssued(result.record);
      query.refetch();
    });
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(token);
      toast('token copied');
    } catch {
      toast('copy failed. select the token text instead.');
    }
  };

  const closeIssued = () => {
    setIssued(null);
    setToken('');
  };

  const closeRevoke = () => {
    if (action.busy) {
      return;
    }
    setRevoking(null);
    action.setError(null);
  };

  const revoke = () => {
    if (!revoking) {
      return;
    }
    const target = revoking;
    void action.run(async () => {
      await api(`/settings/tokens/${target.id}`, { method: 'DELETE' });
      setRevoking(null);
      toast(`${target.name} revoked`);
      query.refetch();
    });
  };

  return (
    <>
      <Card className="overflow-hidden p-0">
        <header className="border-border border-b bg-bg-elevated px-5 py-3">
          <h2 className="section-label text-primary">personal access tokens</h2>
          <p className="mt-1 max-w-3xl text-[12px] text-muted leading-relaxed">
            Bearer tokens for headless agents and CI. A token reads this
            workspace through MCP exactly like a connected app: read-only,
            scoped to this workspace, and rate-limited. The token is shown once
            at creation.
          </p>
        </header>

        <div
          className={cn(
            TOKEN_GRID,
            'hidden min-h-9 items-center bg-bg-elevated md:grid',
          )}
        >
          <div className="section-label border-border border-r px-5">name</div>
          <div className="section-label border-border border-r px-4">token</div>
          <div className="section-label border-border border-r px-4">
            created
          </div>
          <div className="section-label border-border border-r px-4">
            last used
          </div>
          <div className="section-label px-5 text-right">action</div>
        </div>

        {query.loading && !query.data ? (
          <div className="flex flex-col gap-px bg-border">
            <Skeleton className="h-14 rounded-none" />
          </div>
        ) : query.error && !query.data ? (
          <EmptyState
            title="tokens unavailable"
            hint="Personal access tokens could not be loaded."
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
        ) : query.data?.tokens.length === 0 ? (
          <EmptyState
            title="no tokens"
            hint="Create one to let a headless agent read this workspace."
            className="border-0"
          />
        ) : (
          <ul>
            {query.data?.tokens.map((record) => (
              <li
                key={record.id}
                className={cn(TOKEN_GRID, 'border-border border-t')}
              >
                <div className="flex min-w-0 items-center px-5 py-3 md:border-border md:border-r">
                  <span className="truncate text-[13px] text-primary">
                    {record.name}
                  </span>
                </div>
                <div className="flex items-center border-border border-t px-5 py-2 font-mono text-[11px] text-muted md:border-t-0 md:border-r md:px-4">
                  <span className="field-label md:hidden">token</span>
                  <span className="truncate">{record.tokenPrefix}…</span>
                </div>
                <div
                  className="flex items-center border-border border-t px-5 py-2 font-mono text-[11px] text-muted md:border-t-0 md:border-r md:px-4"
                  title={timestamp(record.createdAt)}
                >
                  <span className="field-label md:hidden">created</span>
                  {timestamp(record.createdAt)}
                </div>
                <div
                  className="flex items-center border-border border-t px-5 py-2 font-mono text-[11px] text-muted md:border-t-0 md:border-r md:px-4"
                  title={timestamp(record.lastUsedAt)}
                >
                  <span className="field-label md:hidden">last used</span>
                  {timestamp(record.lastUsedAt)}
                </div>
                <div className="flex items-center justify-end border-border border-t px-5 py-2 md:border-t-0">
                  <button
                    type="button"
                    className="btn-ghost h-7 px-2 font-mono text-[11px] text-error"
                    onClick={() => {
                      action.setError(null);
                      setRevoking(record);
                    }}
                  >
                    revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={create}
          className="flex flex-col gap-3 border-border border-t px-5 py-4 md:flex-row md:items-end md:justify-between"
        >
          <div>
            <label htmlFor="new-token" className="field-label">
              create token
            </label>
            <p className="mt-1 text-[12px] text-muted">
              Name it after the agent or pipeline that will use it.
            </p>
          </div>
          <div className="flex min-w-0 gap-2 md:w-[420px]">
            <input
              id="new-token"
              className="input h-9 min-w-0 flex-1"
              placeholder="token name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={1}
              maxLength={60}
              required
            />
            <button
              type="submit"
              className="btn-secondary"
              disabled={busy || name.trim().length === 0}
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

      {issued ? (
        <Modal title={`${issued.name} token`} onClose={closeIssued}>
          <p className="text-[13px] text-secondary leading-relaxed">
            Copy this token now. It is stored only as a hash and cannot be shown
            again. Use it as a bearer token against{' '}
            <span className="font-mono text-[12px]">api.refd.ai/mcp</span>.
          </p>
          <div className="mt-4 flex items-center gap-2 border border-border bg-bg-elevated px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-primary">
              {token}
            </code>
            <button
              type="button"
              className="btn-ghost h-7 shrink-0 px-2 font-mono text-[11px]"
              onClick={() => void copyToken()}
            >
              copy
            </button>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={closeIssued}
            >
              done
            </button>
          </div>
        </Modal>
      ) : null}

      {revoking ? (
        <Modal title={`Revoke ${revoking.name}?`} onClose={closeRevoke}>
          <p className="text-[13px] text-secondary leading-relaxed">
            This immediately revokes the token. Anything using it will start
            failing on its next request.
          </p>
          {action.error ? (
            <p className="mt-3 text-[13px] text-error" aria-live="polite">
              {action.error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={closeRevoke}
              disabled={action.busy}
            >
              cancel
            </button>
            <button
              type="button"
              className="btn-secondary text-error"
              onClick={revoke}
              disabled={action.busy}
            >
              {action.busy ? 'revoking…' : 'revoke token'}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
};

const CONNECTION_GRID =
  'grid md:grid-cols-[minmax(180px,1fr)_minmax(170px,0.8fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(90px,0.4fr)]';

const ConnectedAppsCard = () => {
  const query = useQuery<{ connections: ConnectedApp[] }>(
    '/settings/connections',
  );
  const [revoking, setRevoking] = useState<ConnectedApp | null>(null);
  const action = useAsyncAction();
  const toast = useToast();

  const close = () => {
    if (action.busy) {
      return;
    }
    setRevoking(null);
    action.setError(null);
  };

  const revoke = () => {
    if (!revoking) {
      return;
    }
    const connection = revoking;
    void action.run(async () => {
      await api(`/settings/connections/${connection.id}`, {
        method: 'DELETE',
      });
      setRevoking(null);
      toast(`${connection.clientName} disconnected`);
      query.refetch();
    });
  };

  return (
    <>
      <Card className="overflow-hidden p-0">
        <header className="border-border border-b bg-bg-elevated px-5 py-3">
          <h2 className="section-label text-primary">connected apps</h2>
          <p className="mt-1 max-w-3xl text-[12px] text-muted leading-relaxed">
            Apps listed here can read the workspaces you approved through MCP. A
            connection with the optional setup scope can also configure a
            workspace and start its one provider-backed onboarding report. No
            connection can delete data or start further provider runs. A
            connection may cover several workspaces; revoking it disconnects the
            app from all of them.
          </p>
        </header>

        <div
          className={cn(
            CONNECTION_GRID,
            'hidden min-h-9 items-center bg-bg-elevated md:grid',
          )}
        >
          <div className="section-label border-border border-r px-5">app</div>
          <div className="section-label border-border border-r px-4">
            permission
          </div>
          <div className="section-label border-border border-r px-4">
            connected
          </div>
          <div className="section-label border-border border-r px-4">
            last used
          </div>
          <div className="section-label px-5 text-right">action</div>
        </div>

        {query.loading && !query.data ? (
          <div className="flex flex-col gap-px bg-border">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-14 rounded-none" />
            ))}
          </div>
        ) : query.error && !query.data ? (
          <EmptyState
            title="connections unavailable"
            hint="Connected apps could not be loaded."
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
        ) : query.data?.connections.length === 0 ? (
          <EmptyState
            title="no connected apps"
            hint="Apps you authorize through OAuth will appear here."
            className="border-0"
          />
        ) : (
          <ul>
            {query.data?.connections.map((connection) => {
              const hint = callbackHint(connection.callbackTarget);
              return (
                <li
                  key={connection.id}
                  className={cn(CONNECTION_GRID, 'border-border border-t')}
                >
                  <div className="flex min-w-0 flex-col justify-center px-5 py-3 md:border-border md:border-r">
                    <span className="truncate text-[13px] text-primary">
                      {connection.clientName}
                    </span>
                    <span className="font-mono text-[10px] text-error uppercase tracking-[0.08em]">
                      unverified app
                    </span>
                    <span
                      className="truncate font-mono text-[10px] text-muted"
                      title={connection.callbackTarget ?? 'Legacy connection'}
                    >
                      {hint ? `${hint} · callback: ` : 'callback: '}
                      {connection.callbackTarget ?? 'unavailable'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-border border-t px-5 py-2 md:border-t-0 md:border-r md:px-4">
                    <span className="field-label md:hidden">permission</span>
                    {connection.scopes.map((scope) => (
                      <Badge key={scope} tone="neutral">
                        {scope === 'data:read' ? 'read workspace data' : scope}
                      </Badge>
                    ))}
                    <Badge tone="neutral">
                      {connection.allWorkspaces
                        ? 'all workspaces'
                        : connection.workspaceCount > 1
                          ? `${connection.workspaceCount} workspaces`
                          : (connection.workspaceName ?? 'one workspace')}
                    </Badge>
                  </div>
                  <div
                    className="flex items-center gap-2 border-border border-t px-5 py-2 font-mono text-[11px] text-muted md:border-t-0 md:border-r md:px-4"
                    title={timestamp(connection.createdAt)}
                  >
                    <span className="field-label md:hidden">connected</span>
                    {timestamp(connection.createdAt)}
                  </div>
                  <div
                    className="flex items-center gap-2 border-border border-t px-5 py-2 font-mono text-[11px] text-muted md:border-t-0 md:border-r md:px-4"
                    title={timestamp(connection.lastUsedAt)}
                  >
                    <span className="field-label md:hidden">last used</span>
                    {timestamp(connection.lastUsedAt)}
                  </div>
                  <div className="flex items-center justify-end border-border border-t px-5 py-2 md:border-t-0">
                    <button
                      type="button"
                      className="btn-ghost h-7 px-2 font-mono text-[11px] text-error"
                      onClick={() => {
                        action.setError(null);
                        setRevoking(connection);
                      }}
                    >
                      revoke
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {revoking ? (
        <Modal title={`Disconnect ${revoking.clientName}?`} onClose={close}>
          <p className="text-[13px] text-secondary leading-relaxed">
            This immediately revokes the app&apos;s access and refresh tokens
            for{' '}
            {revoking.allWorkspaces
              ? 'every workspace on the account'
              : revoking.workspaceCount > 1
                ? `all ${revoking.workspaceCount} workspaces it covers`
                : 'this workspace'}
            . The app will need your approval to reconnect.
          </p>
          {action.error ? (
            <p className="mt-3 text-[13px] text-error" aria-live="polite">
              {action.error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={close}
              disabled={action.busy}
            >
              cancel
            </button>
            <button
              type="button"
              className="btn-secondary text-error"
              onClick={revoke}
              disabled={action.busy}
            >
              {action.busy ? 'disconnecting…' : 'disconnect app'}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
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
      description="Manage workspaces, run schedules, and the AI surfaces monitored in each run."
    />

    <div className="flex flex-col gap-4">
      <WorkspacesCard />
      <SurfacesCard />
      <ScheduleCard />
      <ConnectedAppsCard />
      <TokensCard />
      {import.meta.env.DEV ? <RescoreCard /> : null}
    </div>
  </>
);
