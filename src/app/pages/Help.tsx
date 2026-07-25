import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { DitherIcon } from '@/components/dither/DitherIcon';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui';
import {
  GLOSSARY_TERMS,
  type GlossaryDefinition,
  TERM_CATEGORIES,
} from '@/lib/glossary';
import { METRIC_CATEGORIES, METRIC_GLOSSARY } from '@/lib/metric-copy';
import { PROMPT_CATEGORY_GLOSSARY } from '@/lib/prompt-categories';
import { cn } from '@/lib/utils';

export const Help = () => (
  <>
    <PageHeader
      title="Help"
      description="Product guides, definitions, and practical reference for using refd."
    />
    <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border border-border bg-bg-card lg:sticky lg:top-6">
        <div className="section-label border-border border-b bg-bg-elevated px-4 py-3 text-primary">
          Help library
        </div>
        <nav aria-label="Help pages" className="p-1.5">
          <NavLink
            to="/help/glossary"
            className={({ isActive }) =>
              cn(
                'flex min-h-11 items-center gap-2.5 px-2.5 text-[13px] transition-colors hover:bg-bg-card-hover hover:text-primary',
                isActive
                  ? 'bg-accent-soft text-primary shadow-[inset_1px_0_0_var(--color-primary)]'
                  : 'text-secondary',
              )
            }
          >
            <DitherIcon name="info" size={13} className="shrink-0" />
            <span>
              <span className="block">Glossary</span>
              <span className="mt-0.5 block font-mono text-[9px] text-muted uppercase tracking-[0.08em]">
                product terms and metrics
              </span>
            </span>
          </NavLink>
        </nav>
      </aside>
      <Outlet />
    </div>
  </>
);

const GLOSSARY_CATEGORIES = [
  ...TERM_CATEGORIES,
  'Prompt categories',
  ...METRIC_CATEGORIES,
] as const;

const GLOSSARY_ENTRIES = [
  ...GLOSSARY_TERMS,
  ...PROMPT_CATEGORY_GLOSSARY,
  ...METRIC_GLOSSARY,
] satisfies GlossaryDefinition[];

const matchesQuery = (entry: GlossaryDefinition, query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return true;
  }
  return [entry.title, entry.category, entry.definition, entry.details].some(
    (value) => value.toLocaleLowerCase().includes(normalized),
  );
};

export const Glossary = () => {
  const [query, setQuery] = useState('');
  const { hash } = useLocation();
  const groups = useMemo(
    () =>
      GLOSSARY_CATEGORIES.map((category) => ({
        category,
        entries: GLOSSARY_ENTRIES.filter(
          (entry) => entry.category === category && matchesQuery(entry, query),
        ),
      })).filter((group) => group.entries.length > 0),
    [query],
  );

  useEffect(() => {
    if (!hash) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  return (
    <section aria-labelledby="glossary-title" className="min-w-0">
      <header className="flex flex-wrap items-end justify-between gap-4 border border-border bg-bg-card p-5">
        <div>
          <h2
            id="glossary-title"
            className="font-[550] text-[18px] text-primary tracking-[-0.02em]"
          >
            Glossary
          </h2>
          <p className="mt-1 max-w-xl text-[12px] text-muted leading-relaxed">
            Definitions and usage notes for the product terms, prompt
            categories, metrics, and signals used in the dashboard.
          </p>
        </div>
        <label className="w-full sm:w-72">
          <span className="sr-only">Search glossary</span>
          <input
            type="search"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search the glossary"
          />
        </label>
      </header>

      {groups.length > 0 ? (
        <div className="mt-4 flex flex-col gap-4">
          {groups.map((group) => (
            <section
              key={group.category}
              aria-labelledby={`glossary-${group.category.toLocaleLowerCase().replaceAll(' ', '-')}`}
              className="border border-border bg-bg-card"
            >
              <h3
                id={`glossary-${group.category.toLocaleLowerCase().replaceAll(' ', '-')}`}
                className="section-label sticky top-12 z-10 border-border border-b bg-bg-elevated px-4 py-3 text-primary lg:top-0"
              >
                {group.category}
              </h3>
              <div>
                {group.entries.map((entry, index) => (
                  <article
                    key={entry.id}
                    id={entry.id}
                    tabIndex={-1}
                    className={cn(
                      'scroll-mt-24 px-4 py-4 transition-colors target:bg-accent-soft target:shadow-[inset_2px_0_0_var(--color-primary)] sm:px-5 lg:scroll-mt-12',
                      index > 0 && 'border-border border-t',
                    )}
                  >
                    <h4 className="font-[550] text-[14px] text-primary">
                      {entry.title}
                    </h4>
                    <p className="mt-1 text-[13px] text-secondary leading-relaxed">
                      {entry.definition}
                    </p>
                    <p className="mt-2 text-[12px] text-muted leading-relaxed">
                      {entry.details}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          title="no matching terms"
          hint="Try a product term, prompt category, metric, or signal."
          className="mt-4 min-h-56"
          action={
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setQuery('')}
            >
              clear search
            </button>
          }
        />
      )}
    </section>
  );
};
