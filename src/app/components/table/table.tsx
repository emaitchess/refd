import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MetricInfo } from '@/components/ui/MetricInfo';
import type { MetricDefinition } from '@/lib/metric-copy';
import { cn } from '@/lib/utils';

type SortValue = string | number | null;

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

// Nulls sort last regardless of direction (an unranked entity isn't "best").
export const useSort = <T,>(
  rows: T[],
  accessors: SortAccessors<T>,
  initial: SortState,
) => {
  const initialRef = useRef(initial);
  const [userSort, setUserSort] = useState<SortState | null>();
  const sort = userSort === undefined ? initialRef.current : userSort;
  const sorted = useMemo(() => {
    if (!sort) {
      return rows;
    }
    const accessor = accessors[sort.key];
    if (!accessor) {
      return rows;
    }
    return [...rows].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (va == null && vb == null) {
        return 0;
      }
      if (va == null) {
        return 1;
      }
      if (vb == null) {
        return -1;
      }
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, accessors, sort]);

  const toggle = (key: string) =>
    setUserSort((current) => {
      if (!current || current.key !== key) {
        return { key, dir: 'desc' };
      }
      return current.dir === 'desc' ? { key, dir: 'asc' } : null;
    });

  return { sorted, sort, toggle };
};

export interface PaginationState<T> {
  view: T[];
  page: number;
  pages: number;
  total: number;
  start: number;
  end: number;
  setPage: (page: number) => void;
}

export const usePagination = <T,>(
  rows: T[],
  pageSize: number,
): PaginationState<T> => {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const clamped = Math.min(page, pages - 1);
  const view = useMemo(
    () => rows.slice(clamped * pageSize, (clamped + 1) * pageSize),
    [rows, clamped, pageSize],
  );
  return {
    view,
    page: clamped,
    pages,
    total: rows.length,
    start: rows.length === 0 ? 0 : clamped * pageSize + 1,
    end: Math.min((clamped + 1) * pageSize, rows.length),
    setPage,
  };
};

// Renders nothing while everything fits on one page.
export const Pagination = <T,>({ state }: { state: PaginationState<T> }) => {
  if (state.pages <= 1) {
    return null;
  }
  return (
    <div className="flex items-center justify-between border-border border-t px-4 py-2">
      <span className="font-mono text-[11px] text-muted">
        {state.start}–{state.end} of {state.total}
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          className="btn-ghost h-6 px-2 font-mono text-[12px]"
          disabled={state.page === 0}
          onClick={() => state.setPage(state.page - 1)}
        >
          ‹ prev
        </button>
        <span className="font-mono text-[11px] text-muted">
          {state.page + 1}/{state.pages}
        </span>
        <button
          type="button"
          className="btn-ghost h-6 px-2 font-mono text-[12px]"
          disabled={state.page === state.pages - 1}
          onClick={() => state.setPage(state.page + 1)}
        >
          next ›
        </button>
      </span>
    </div>
  );
};

// Props for a table row that behaves like a button. A bare `onClick` on a <tr>
// makes the row mouse-only; this adds the keyboard half (Enter/Space) and a tab
// stop, so a drill-down pane is reachable without a pointer.
export const rowActivation = (onActivate: () => void) => ({
  onClick: onActivate,
  onKeyDown: (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    // Space would scroll the page.
    event.preventDefault();
    onActivate();
  },
  tabIndex: 0,
});

export interface ColumnSpec {
  key: string;
  min?: number; // px floor; a column can never be dragged narrower than this
  // Share of the table width, 0-1. Give every column one for a designed default
  // layout; omit them all to fall back to the browser's content measurement.
  fraction?: number;
}

const DEFAULT_MIN = 64;
const KEY_STEP = 16; // px per arrow-key press

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

// Stored as fractions of the table width, not px, so a layout saved on a wide
// window restores sensibly on a narrow one.
const loadFractions = (
  storageKey: string,
  keys: string[],
): Record<string, number> | null => {
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(`cols:${storageKey}`) ?? 'null',
    );
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const rec = raw as Record<string, unknown>;
    // Reject a stale layout whose columns no longer match this table.
    if (
      Object.keys(rec).length !== keys.length ||
      keys.some((k) => typeof rec[k] !== 'number')
    ) {
      return null;
    }
    return Object.fromEntries(keys.map((k) => [k, rec[k] as number]));
  } catch {
    return null; // corrupted storage: fall back to measured defaults
  }
};

// Resizable column widths for a `table-fixed` table.
//
// The intelligence is in three rules:
//  1. Seed from the column's `fraction` when given, else from the browser's own
//     auto-layout pass. Either way the widths sum to the table width, which is
//     what makes a drag track the cursor 1:1 instead of drifting by a scale
//     factor. Fractions are worth setting: a measured default silently shifts
//     with the content it happened to measure.
//  2. A drag moves one divider: the column grows by exactly what its neighbour
//     gives up, both clamped to their minimums. The total never changes, so the
//     table can't spawn a horizontal scrollbar and untouched columns stay put.
//  3. Widths persist as fractions and re-scale with the container, so the
//     proportions a user picks survive a reload or a window resize.
export const useColumnWidths = (storageKey: string, columns: ColumnSpec[]) => {
  const [widths, setWidths] = useState<Record<string, number> | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const totalRef = useRef(0);
  const specRef = useRef(columns);
  specRef.current = columns;
  const keys = useMemo(() => columns.map((c) => c.key), [columns]);

  const persist = useCallback(
    (next: Record<string, number>) => {
      const total = Object.values(next).reduce((s, w) => s + w, 0);
      if (total <= 0) {
        return;
      }
      try {
        localStorage.setItem(
          `cols:${storageKey}`,
          JSON.stringify(
            Object.fromEntries(
              Object.entries(next).map(([k, w]) => [k, w / total]),
            ),
          ),
        );
      } catch {
        // storage full or blocked: widths still work for this session
      }
    },
    [storageKey],
  );

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || widthsRef.current) {
      return;
    }
    const total = table.clientWidth;
    if (!total) {
      return;
    }
    totalRef.current = total;
    const stored = loadFractions(storageKey, keys);
    if (stored) {
      setWidths(
        Object.fromEntries(keys.map((k) => [k, (stored[k] ?? 0) * total])),
      );
      return;
    }
    const specs = specRef.current;
    if (specs.every((c) => typeof c.fraction === 'number')) {
      setWidths(
        Object.fromEntries(
          specs.map((c) => [c.key, (c.fraction ?? 0) * total]),
        ),
      );
      return;
    }
    const cells = [...table.querySelectorAll('thead th')];
    setWidths(
      Object.fromEntries(
        keys.map((k, i) => {
          const cell = cells[i];
          return [
            k,
            cell instanceof HTMLElement
              ? cell.offsetWidth
              : total / keys.length,
          ];
        }),
      ),
    );
  }, [keys, storageKey]);

  // Keep the user's proportions when the container changes width.
  useEffect(() => {
    const table = tableRef.current;
    if (!table) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const total = table.clientWidth;
      const current = widthsRef.current;
      const previous = totalRef.current;
      if (!total || !current || !previous || Math.abs(total - previous) < 1) {
        return;
      }
      totalRef.current = total;
      const factor = total / previous;
      setWidths(
        Object.fromEntries(
          Object.entries(current).map(([k, w]) => [k, w * factor]),
        ),
      );
    });
    observer.observe(table);
    return () => observer.disconnect();
  }, []);

  // Move the divider on `key`'s right edge by `dx`, trading width with the next
  // column only. Returns the applied widths so callers can persist on release.
  const applyDelta = useCallback(
    (key: string, dx: number, from?: Record<string, number>) => {
      const base = from ?? widthsRef.current;
      if (!base) {
        return null;
      }
      const index = specRef.current.findIndex((c) => c.key === key);
      const neighbour = specRef.current[index + 1];
      if (!neighbour) {
        return null; // last column has no divider to drag
      }
      const a0 = base[key] ?? 0;
      const b0 = base[neighbour.key] ?? 0;
      const minA = specRef.current[index]?.min ?? DEFAULT_MIN;
      const minB = neighbour.min ?? DEFAULT_MIN;
      const a = clamp(a0 + dx, minA, Math.max(minA, a0 + b0 - minB));
      const next = { ...base, [key]: a, [neighbour.key]: a0 + b0 - a };
      setWidths(next);
      return next;
    },
    [],
  );

  const startResize = useCallback(
    (key: string, clientX: number) => {
      const base = widthsRef.current;
      if (!base) {
        return;
      }
      const onMove = (event: PointerEvent) =>
        applyDelta(key, event.clientX - clientX, base);
      const onUp = (event: PointerEvent) => {
        const next = applyDelta(key, event.clientX - clientX, base);
        if (next) {
          persist(next);
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.classList.remove('select-none');
      };
      // Without this a drag across the header selects the label text.
      document.body.classList.add('select-none');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [applyDelta, persist],
  );

  const nudge = useCallback(
    (key: string, direction: -1 | 1) => {
      const next = applyDelta(key, direction * KEY_STEP);
      if (next) {
        persist(next);
      }
    },
    [applyDelta, persist],
  );

  // Back to the designed fractions when this table defines them. Resetting to
  // null alone would leave the hook with no dependency change to re-seed them.
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(`cols:${storageKey}`);
    } catch {
      // ignore
    }
    const total = tableRef.current?.clientWidth ?? totalRef.current;
    const specs = specRef.current;
    if (
      total > 0 &&
      specs.every((column) => typeof column.fraction === 'number')
    ) {
      totalRef.current = total;
      setWidths(
        Object.fromEntries(
          specs.map((column) => [column.key, (column.fraction ?? 0) * total]),
        ),
      );
      return;
    }
    setWidths(null);
  }, [storageKey]);

  return { tableRef, widths, startResize, nudge, reset };
};

// Explicit widths for every column; render inside the table, above <thead>.
export const ColGroup = ({
  columns,
  widths,
}: {
  columns: ColumnSpec[];
  widths: Record<string, number> | null;
}) => (
  <colgroup>
    {columns.map((c) => (
      <col
        key={c.key}
        style={widths ? { width: `${widths[c.key]}px` } : undefined}
      />
    ))}
  </colgroup>
);

// The grab handle on a column's right edge. Lives inside a `relative` <th>; the
// hit area is wider than the 1px rule it draws. Double-click resets the table.
export const ColResizer = ({
  label,
  onStart,
  onNudge,
  onReset,
}: {
  label: string;
  onStart: (clientX: number) => void;
  onNudge: (direction: -1 | 1) => void;
  onReset: () => void;
}) => (
  <button
    type="button"
    aria-label={`Resize ${label} column`}
    className="group/resize absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none items-center justify-center"
    onPointerDown={(e) => {
      e.preventDefault();
      onStart(e.clientX);
    }}
    onDoubleClick={onReset}
    onKeyDown={(e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
        return;
      }
      e.preventDefault();
      onNudge(e.key === 'ArrowLeft' ? -1 : 1);
    }}
  >
    <span className="h-1/2 w-px bg-transparent transition-colors group-hover/resize:bg-border-strong group-focus-visible/resize:bg-border-strong" />
  </button>
);

export const Th = ({
  label,
  info,
  sortKey,
  sort,
  onToggle,
  align = 'left',
  className,
  resizer,
}: {
  label: string;
  info?: MetricDefinition;
  sortKey?: string;
  sort?: SortState | null;
  onToggle?: (key: string) => void;
  align?: 'left' | 'right';
  className?: string;
  resizer?: ReactNode;
}) => (
  <th
    aria-sort={
      sortKey
        ? sort?.key === sortKey
          ? sort.dir === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
        : undefined
    }
    className={cn(
      'section-label whitespace-nowrap px-2 py-2.5 font-normal',
      align === 'right' ? 'text-right' : 'text-left',
      resizer && 'relative',
      className,
    )}
  >
    <span className="inline-flex items-center gap-1">
      {sortKey && onToggle ? (
        <button
          type="button"
          onClick={() => onToggle(sortKey)}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors hover:text-primary',
            sort?.key === sortKey && 'text-primary',
          )}
        >
          {label}
          <span className="w-2">
            {sort?.key === sortKey ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
          </span>
        </button>
      ) : (
        label
      )}
      {info ? <MetricInfo label={label.toLowerCase()} metric={info} /> : null}
    </span>
    {resizer}
  </th>
);
