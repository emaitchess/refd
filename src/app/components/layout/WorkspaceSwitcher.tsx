import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { Modal } from '@/components/ui';
import { useAsyncAction } from '@/lib/api';
import { useOnKeyPress } from '@/lib/keyboard';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/providers/workspace';
import { Fade } from './Fade';
import { WorkspaceIcon } from './WorkspaceIcon';

// Workspace selector: current name + dropdown of owned workspaces + create.
// The menu is a fixed-position flyout (beside the collapsed rail, below the
// expanded button) so the rail's width never squeezes it.
export const WorkspaceSwitcher = ({ expanded }: { expanded: boolean }) => {
  const { workspaces, current, switchTo, create } = useWorkspace();
  const navigate = useNavigate();
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const { busy, error, run } = useAsyncAction();

  useOnKeyPress('Escape', () => setMenuPos(null), {
    enabled: menuPos !== null,
    ignoreWhenTyping: false,
  });
  useEffect(() => {
    if (!menuPos) {
      return;
    }
    const close = () => setMenuPos(null);
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close();
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [menuPos]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run(async () => {
      await create(name.trim());
      setName('');
      setCreating(false);
      setMenuPos(null);
      navigate('/onboarding');
    });
  };

  return (
    <div ref={rootRef}>
      <Tooltip
        asChild
        content={current?.name ?? 'Workspace'}
        placement="right"
        offset={8}
        disabled={expanded || menuPos !== null}
        className="border-border-strong bg-bg-elevated text-primary shadow-lg"
      >
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={menuPos !== null}
          onClick={(event) => {
            if (menuPos) {
              setMenuPos(null);
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuPos(
              expanded
                ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
                : { top: rect.top, left: rect.right + 8, width: 176 },
            );
          }}
          // One constant layout in both states: the chip sits on the fixed icon
          // axis (center x=28 — which IS the rail's center), labels stay mounted
          // and fade; the button clips them. Nothing moves when the width animates.
          className="flex h-9 w-full cursor-pointer items-center gap-2 overflow-hidden border border-border border-x-0 pr-2 pl-[20px] transition-colors hover:bg-bg-card-hover"
        >
          <WorkspaceIcon
            name={current?.name ?? '?'}
            domain={current?.brandDomain}
            size={16}
          />
          <Fade show={expanded}>
            <span className="max-w-32 truncate font-mono text-[12px] text-primary">
              {current?.name ?? 'workspace'}
            </span>
          </Fade>
          <Fade show={expanded} className="ml-auto">
            <span className="font-mono text-[10px] text-muted">▾</span>
          </Fade>
        </button>
      </Tooltip>
      {menuPos ? (
        <div
          role="listbox"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            minWidth: menuPos.width,
          }}
          className="fixed z-40 border border-border-strong bg-bg-elevated py-1 shadow-lg"
        >
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              role="option"
              aria-selected={ws.id === current?.id}
              onClick={() => {
                setMenuPos(null);
                switchTo(ws.id);
                if (!ws.onboardingCompleted) {
                  navigate('/onboarding');
                }
              }}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-bg-card-hover',
                ws.id === current?.id
                  ? 'text-primary'
                  : 'text-secondary hover:text-primary',
              )}
            >
              <WorkspaceIcon name={ws.name} domain={ws.brandDomain} size={14} />
              <span className="min-w-0 truncate">{ws.name}</span>
              {!ws.onboardingCompleted ? (
                <Tooltip
                  asChild
                  content="Setup required"
                  className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                >
                  <span className="ml-auto shrink-0 text-warning">
                    <DitherIcon name="warning" size={12} />
                    <span className="sr-only">Setup required</span>
                  </span>
                </Tooltip>
              ) : null}
              {/* The favicon took the marker's slot, so selection moves right. */}
              {ws.id === current?.id ? (
                <span
                  className={cn(
                    'shrink-0 text-[10px]',
                    ws.onboardingCompleted && 'ml-auto',
                  )}
                >
                  ■
                </span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setMenuPos(null);
              setCreating(true);
            }}
            className="block w-full cursor-pointer whitespace-nowrap border-border border-t px-3 py-1.5 text-left font-mono text-[11px] text-secondary transition-colors hover:bg-bg-card-hover hover:text-primary"
          >
            + new workspace
          </button>
        </div>
      ) : null}
      {creating ? (
        <Modal title="New workspace" onClose={() => setCreating(false)}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="section-label">Name</span>
              <input
                className="input"
                placeholder="brand or project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={1}
                maxLength={60}
                required
                autoFocus
              />
            </label>
            <p className="text-[12px] text-muted">
              A workspace tracks one brand: its own competitors, prompts, and
              runs. Creating it opens the guided brand setup.
            </p>
            {error ? <p className="text-[13px] text-error">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCreating(false)}
              >
                cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'creating…' : 'create workspace'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
};
