import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Tooltip } from '@/components/dither-kit/tooltip';
import {
  Badge,
  Card,
  EmptyState,
  EntityChip,
  Favicon,
  Skeleton,
} from '@/components/ui';
import { api, useAsyncAction, useQuery } from '@/lib/api';
import type { EntityAlias } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AliasEntity {
  id: number;
  name: string;
  domains: string[];
  aliases: EntityAlias[];
  isBrand: boolean;
  sortOrder: number;
}

export const AliasesCard = ({
  refreshToken,
  onChange,
}: {
  refreshToken: string;
  onChange: () => void;
}) => {
  const {
    data,
    loading,
    error: queryError,
    refetch,
  } = useQuery<{
    entities: AliasEntity[];
  }>('/entities');
  const { busy, error, setError, run } = useAsyncAction();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [caseFlags, setCaseFlags] = useState<Record<number, boolean>>({});
  const previousRefreshToken = useRef(refreshToken);
  const entities = [...(data?.entities ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  useEffect(() => {
    if (previousRefreshToken.current === refreshToken) {
      return;
    }
    previousRefreshToken.current = refreshToken;
    refetch();
  }, [refetch, refreshToken]);

  const save = async (entity: AliasEntity, aliases: EntityAlias[]) => {
    await api(`/entities/${entity.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ aliases }),
    });
    refetch();
    onChange();
  };

  const addAlias = (entity: AliasEntity) => (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const value = (drafts[entity.id] ?? '').trim();
    if (!value) {
      return;
    }
    const covered = new Set([
      entity.name.toLowerCase(),
      ...entity.aliases.map((alias) => alias.value.toLowerCase()),
    ]);
    if (covered.has(value.toLowerCase())) {
      setError(`"${value}" is already matched for ${entity.name}`);
      return;
    }
    const caseSensitive = caseFlags[entity.id] === true;
    void run(async () => {
      await save(entity, [
        ...entity.aliases,
        caseSensitive ? { value, caseSensitive } : { value },
      ]);
      setDrafts((current) => ({ ...current, [entity.id]: '' }));
    });
  };

  const removeAlias = (entity: AliasEntity, index: number) => {
    setError(null);
    void run(async () => {
      await save(
        entity,
        entity.aliases.filter((_, aliasIndex) => aliasIndex !== index),
      );
    });
  };

  return (
    <Card className="overflow-hidden p-0">
      <header className="border-border border-b bg-bg-elevated px-5 py-3">
        <h2 className="section-label text-primary">entity aliases</h2>
        <p className="mt-1 max-w-4xl text-[12px] text-muted leading-relaxed">
          Add nicknames, former names, and spaced variants that should count as
          mentions. Use case-exact matching for short terms that may appear in
          ordinary text.
        </p>
      </header>

      {queryError && data ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 border-border border-b px-4 py-3"
        >
          <p className="text-[13px] text-error">{queryError}</p>
          <button type="button" className="btn-secondary" onClick={refetch}>
            retry
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="grid min-h-24 border-border border-t first:border-t-0 lg:grid-cols-[minmax(200px,0.8fr)_minmax(260px,1.2fr)_minmax(300px,1fr)]"
            >
              <div className="flex items-center px-5 lg:border-border lg:border-r">
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="flex items-center px-5 lg:border-border lg:border-r">
                <Skeleton className="h-6 w-40" />
              </div>
              <div className="flex items-center px-5">
                <Skeleton className="h-8 w-full max-w-72" />
              </div>
            </div>
          ))}
        </div>
      ) : !data && queryError ? (
        <div className="p-4">
          <EmptyState
            title="aliases unavailable"
            hint="Entity aliases could not be loaded."
            action={
              <button type="button" className="btn-secondary" onClick={refetch}>
                retry
              </button>
            }
            className="border-0"
          />
        </div>
      ) : entities.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="no entities"
            hint="Add a competitor before configuring aliases."
            className="border-0"
          />
        </div>
      ) : (
        <ul>
          {entities.map((entity, index) => {
            const firstDomain = entity.domains[0] ?? '';
            return (
              <li
                key={entity.id}
                className="grid border-border border-t first:border-t-0 lg:grid-cols-[minmax(200px,0.8fr)_minmax(260px,1.2fr)_minmax(300px,1fr)]"
              >
                <div className="flex min-w-0 items-center gap-2 px-5 py-4 lg:border-border lg:border-r">
                  <Favicon domain={firstDomain} size={16} />
                  <span className="min-w-0 truncate">
                    <EntityChip name={entity.name} sortIndex={index} />
                  </span>
                  {entity.isBrand ? <Badge tone="neutral">brand</Badge> : null}
                  <Tooltip
                    asChild
                    content={entity.domains.join(', ')}
                    delay={400}
                    className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                  >
                    <span className="ml-auto hidden truncate font-mono text-[10px] text-muted xl:block">
                      {firstDomain}
                    </span>
                  </Tooltip>
                </div>

                <div className="flex min-h-16 flex-wrap content-center items-center gap-1.5 border-border border-t px-5 py-3 lg:border-t-0 lg:border-r">
                  {entity.aliases.map((alias, aliasIndex) => (
                    <span
                      key={`${alias.value}-${aliasIndex}`}
                      className="inline-flex h-6 items-center gap-1 border border-border pr-1 pl-2 font-mono text-[11px] text-secondary"
                    >
                      {alias.value}
                      {alias.caseSensitive ? (
                        <Tooltip
                          asChild
                          content="matches case exactly"
                          className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                        >
                          <span className="text-[10px] text-muted">Aa</span>
                        </Tooltip>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Remove alias ${alias.value} from ${entity.name}`}
                        className="cursor-pointer px-0.5 text-muted transition-colors hover:text-primary"
                        onClick={() => removeAlias(entity, aliasIndex)}
                        disabled={busy}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {entity.aliases.length === 0 ? (
                    <span className="font-mono text-[11px] text-muted">
                      no aliases
                    </span>
                  ) : null}
                </div>

                <form
                  onSubmit={addAlias(entity)}
                  className="flex items-center gap-1.5 border-border border-t px-5 py-3 lg:border-t-0"
                >
                  <input
                    className="input h-8 min-w-0 flex-1 font-mono text-[11px]"
                    placeholder="add alias"
                    aria-label={`New alias for ${entity.name}`}
                    value={drafts[entity.id] ?? ''}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [entity.id]: event.target.value,
                      }))
                    }
                    maxLength={60}
                    disabled={entity.aliases.length >= 10}
                  />
                  <Tooltip
                    asChild
                    content="Match case exactly"
                    className="border-border-strong bg-bg-elevated text-primary shadow-lg"
                  >
                    <button
                      type="button"
                      aria-label="Match case exactly"
                      aria-pressed={caseFlags[entity.id] === true}
                      className={cn(
                        'h-8 border px-2 font-mono text-[11px] transition-colors',
                        caseFlags[entity.id]
                          ? 'border-border-strong bg-accent text-on-accent'
                          : 'border-border text-muted hover:text-primary',
                      )}
                      onClick={() =>
                        setCaseFlags((current) => ({
                          ...current,
                          [entity.id]: !current[entity.id],
                        }))
                      }
                    >
                      Aa
                    </button>
                  </Tooltip>
                  <button
                    type="submit"
                    className="btn-ghost h-8 px-2 font-mono text-[11px]"
                    disabled={
                      busy ||
                      entity.aliases.length >= 10 ||
                      !(drafts[entity.id] ?? '').trim()
                    }
                  >
                    add
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p className="border-border border-t px-5 py-3 text-[13px] text-error">
          {error}
        </p>
      ) : null}
    </Card>
  );
};
