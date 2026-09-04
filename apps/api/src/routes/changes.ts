// Change alerts: what materially moved in the brand's AI visibility. Derived
// on read from the same score atoms as every other metric — nothing is
// stored, so a rescore corrects what the card says the next time anyone
// looks.
//
// The comparison unit is a WINDOW of runs, not a single run. At SAMPLES=1 a
// day holds roughly one answer per (prompt, surface) cell, so day-over-day
// deltas are dominated by the non-determinism of the answers themselves: on
// production data the largest daily move across eleven consecutive pairs was
// 3.4 points, which is why a threshold set high enough to suppress that noise
// left nothing above it. A seven-day window pools ~7x the answers, so the
// same thresholds can come down far enough to see real movement.
//
// Two spans, because visibility moves at two speeds. A `shift` compares the
// last window with the one before it and catches an abrupt break. A `drift`
// compares the newest window with the oldest of TREND_WINDOWS and fires only
// when every intermediate step moved the same way — a slow slide that no
// adjacent pair ever breaches on its own, and the shape that a daily
// comparison is structurally blind to.
//
// Four honesty guards: windows are compared only over the (prompt x surface)
// cells that every compared window actually answered, so a partial run can
// never fabricate a change; set-relative metrics (SOV, position, competitor
// movement) are suppressed when the tracked entity set changed anywhere in
// the compared span; deltas under the material thresholds stay silent; and a
// drift needs a consistent direction, so a bounce never reads as a trend.

import { SURFACE_ORDER, surfaceLabel } from '@refd/core/surfaces';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { WorkspaceBindings } from '../auth/middleware';
import { type Db, getDb } from '../db/client';
import { runs } from '../db/schema';
import {
  answerCount,
  avgPosition,
  cellRate,
  type EntityInfo,
  loadEntitiesWithBrand,
  loadScoreRows,
  pooledSov,
  type ScoreRow,
  sentimentDist,
  shareOf,
} from './metrics';

// Days per comparison window. Seven keeps the window aligned to a week, so a
// weekday effect in how AI answers are composed cancels out on both sides.
export const WINDOW_DAYS = 7;
// Windows held for the drift comparison, newest last. Four weeks is long
// enough for a slow slide to clear a threshold and short enough that the
// oldest window still describes the same product.
export const TREND_WINDOWS = 4;

// Material-delta thresholds. Shares move on the 0..1 scale (0.05 = 5
// percentage points); position moves in ranks. These are calibrated to the
// window, not the run: they would fire on noise if pointed at a single day.
// The glossary entry (metric-copy.ts "materialChange") states these numbers
// in prose — the changes tests pin the two together so tuning one updates
// the other.
export const RATE_PP = 0.05;
export const SOV_PP = 0.04;
export const SENTIMENT_PP = 0.05;
export const POSITION_RANKS = 0.25;
// A comparison thinner than this stays silent: a percentage swing over a
// couple of cells is sampling noise wearing a trend costume.
export const MIN_CELLS = 4;
// Position and sentiment are conditional metrics — they also need enough
// qualifying rows (positioned mentions / classified mentions) in every
// window being compared.
export const MIN_CONDITIONAL_N = 3;
// How far a single step may nudge against a drift's overall direction before
// the series stops counting as one: a fifth of the metric's own threshold. A
// trend that pauses for a week is still a trend; one that reverses is not.
const DRIFT_TOLERANCE = 0.2;
const MAX_EVENTS = 6;

export type ChangeType =
  | 'mention_rate'
  | 'citation_rate'
  | 'sov'
  | 'position'
  | 'sentiment'
  | 'competitor';

// 'shift' = this window against the one before. 'drift' = the whole span,
// one direction throughout.
export type ChangeSpan = 'shift' | 'drift';

export interface ChangeEvent {
  type: ChangeType;
  span: ChangeSpan;
  // 'overall' or a surface key. Surface events fire only when the overall
  // delta stayed under threshold: an overall event already tells the story,
  // and a per-surface echo of it would be noise.
  scope: string;
  entity: string;
  direction: 'up' | 'down';
  good: boolean;
  unit: 'share' | 'rank';
  current: number;
  previous: number;
  delta: number;
  severity: number;
  // What moved, without the magnitude: the Overview card pairs this with its
  // own delta chip, so a headline there would state the same number twice.
  subject: string;
  // The full sentence, magnitude included, for consumers that render one
  // string alone (MCP get_recent_changes has no delta chip to lean on).
  headline: string;
  // The same fact phrased as a question the Home agent can be asked — the
  // Overview "ask" affordance and the idle chips both use it verbatim.
  question: string;
}

// A span of consecutive run dates treated as one comparison unit.
export interface WindowRef {
  // Inclusive run dates actually present in the window (not the nominal
  // bounds): a skipped cron day shortens the label rather than implying
  // coverage that never happened.
  from: string;
  to: string;
  runs: number;
  answers: number;
  // Null when the window's runs disagree — which the relative-metric guard
  // already reads as "changed", so a mid-window edit suppresses SOV and
  // position exactly as a between-run edit does.
  entitySetHash: string | null;
}

export interface WindowSlice {
  window: WindowRef;
  rows: ScoreRow[];
}

export interface ChangeReport {
  status: 'ok' | 'needs-runs' | 'thin-overlap';
  // Days per window, so a client can phrase its own copy without guessing.
  windowDays: number;
  latest: WindowRef | null;
  previous: WindowRef | null;
  // Oldest to newest, the span the drift events were read from. Shorter than
  // TREND_WINDOWS (or empty) when the workspace has less history.
  trend: WindowRef[];
  // The compared scope: shared (prompt x surface) cells between the two most
  // recent windows. `trendCells` is the narrower intersection the drift
  // events were read from, since a cell has to survive every window to
  // qualify there.
  cells: number;
  trendCells: number;
  promptCount: number;
  surfaceCount: number;
  entitySetChanged: boolean;
  events: ChangeEvent[];
}

const ppText = (delta: number): string =>
  `${Math.abs(Math.round(delta * 100))} pts`;
const pctText = (v: number): string => `${Math.round(v * 100)}%`;
const rankText = (v: number): string => `#${v.toFixed(1)}`;

const spanDays = (span: ChangeSpan): number =>
  span === 'shift' ? WINDOW_DAYS : WINDOW_DAYS * TREND_WINDOWS;

// Where the reader should look. A shift names both sides because they are
// adjacent and equal; a drift names only its length, because what matters is
// that the direction held the whole way.
const spanPhrase = (span: ChangeSpan): string =>
  span === 'shift'
    ? `between the last ${WINDOW_DAYS} days and the ${WINDOW_DAYS} before`
    : `over the last ${spanDays(span)} days, moving the same way throughout`;

const spanTail = (span: ChangeSpan): string =>
  span === 'shift' ? '' : ` over ${spanDays(span)} days`;

const shareEvent = (
  type: ChangeType,
  span: ChangeSpan,
  scope: string,
  entity: string,
  label: string,
  current: number,
  previous: number,
  goodWhenUp: boolean,
  tail: { up: string; down: string },
): ChangeEvent => {
  const delta = current - previous;
  const direction = delta >= 0 ? 'up' : 'down';
  const verb = direction === 'up' ? 'rose' : 'fell';
  const where = scope === 'overall' ? '' : ` on ${surfaceLabel(scope)}`;
  const subject = `${label}${where}`;
  return {
    type,
    span,
    scope,
    entity,
    direction,
    good: direction === 'up' ? goodWhenUp : !goodWhenUp,
    unit: 'share',
    current,
    previous,
    delta,
    severity: Math.abs(delta),
    subject,
    headline: `${subject} ${verb} ${ppText(delta)}${spanTail(span)}`,
    question: `${label}${where} ${verb} from ${pctText(previous)} to ${pctText(current)} ${spanPhrase(span)}. ${tail[direction]}`,
  };
};

const positionEvent = (
  span: ChangeSpan,
  entity: string,
  current: number,
  previous: number,
): ChangeEvent => {
  const delta = current - previous;
  const direction = delta >= 0 ? 'up' : 'down';
  const verb = direction === 'up' ? 'slipped' : 'improved';
  const ranks = Math.abs(Math.round(delta * 10) / 10);
  const ranksText = `${Number.isInteger(ranks) ? ranks.toFixed(0) : ranks.toFixed(1)} rank${ranks === 1 ? '' : 's'}`;
  return {
    type: 'position',
    span,
    scope: 'overall',
    entity,
    direction,
    // Position counts up as it worsens: a lower number is the good direction.
    good: direction === 'down',
    unit: 'rank',
    current,
    previous,
    delta,
    // Scaled by its own threshold so a threshold-level position move weighs
    // the same as a threshold-level rate move in a mixed sort.
    severity: (Math.abs(delta) / POSITION_RANKS) * RATE_PP,
    subject: 'Average position',
    headline: `Average position ${verb} ${ranksText}${spanTail(span)}`,
    question: `Average position ${verb} from ${rankText(previous)} to ${rankText(current)} ${spanPhrase(span)}. ${
      direction === 'up'
        ? 'Which answers pushed the brand down the order?'
        : 'What is driving the earlier mentions?'
    }`,
  };
};

const cellKey = (r: ScoreRow) => `${r.promptId}:${r.surface}`;

// The cells every compared window answered. Anything else is absence in at
// least one window, and absence is not a value.
const sharedCells = (slices: WindowSlice[]): Set<string> => {
  const [first, ...rest] = slices.map(
    (s) => new Set(s.rows.map(cellKey)),
  ) as Set<string>[];
  if (!first) {
    return new Set();
  }
  return new Set([...first].filter((k) => rest.every((s) => s.has(k))));
};

const setChangedAcross = (slices: WindowSlice[]): boolean => {
  const [first, ...rest] = slices;
  const hash = first?.window.entitySetHash ?? null;
  return hash === null || rest.some((s) => s.window.entitySetHash !== hash);
};

const negativeShare = (rows: ScoreRow[], entityId: number): number | null => {
  const dist = sentimentDist(rows, entityId);
  if (!dist) {
    return null;
  }
  const n = dist.positive + dist.neutral + dist.negative;
  return n >= MIN_CONDITIONAL_N ? dist.negative / n : null;
};

const positiveShare = (rows: ScoreRow[], entityId: number): number | null => {
  const dist = sentimentDist(rows, entityId);
  if (!dist) {
    return null;
  }
  const n = dist.positive + dist.neutral + dist.negative;
  return n >= MIN_CONDITIONAL_N ? dist.positive / n : null;
};

const positionedCount = (rows: ScoreRow[], entityId: number): number =>
  rows.filter((r) => r.entityId === entityId && r.position !== null).length;

export const detectChanges = (
  latest: WindowSlice,
  previous: WindowSlice,
  allEntities: EntityInfo[],
  brand: EntityInfo,
): ChangeReport => {
  const shared = sharedCells([latest, previous]);
  const cur = latest.rows.filter((r) => shared.has(cellKey(r)));
  const prev = previous.rows.filter((r) => shared.has(cellKey(r)));

  const promptIds = new Set<string>();
  const cellsBySurface = new Map<string, number>();
  for (const key of shared) {
    const idx = key.indexOf(':');
    promptIds.add(key.slice(0, idx));
    const surface = key.slice(idx + 1);
    cellsBySurface.set(surface, (cellsBySurface.get(surface) ?? 0) + 1);
  }
  const surfaces = [...cellsBySurface.keys()].sort(
    (a, b) => SURFACE_ORDER.indexOf(a) - SURFACE_ORDER.indexOf(b),
  );
  const entitySetChanged = setChangedAcross([latest, previous]);

  const base = {
    windowDays: WINDOW_DAYS,
    latest: latest.window,
    previous: previous.window,
    trend: [],
    cells: shared.size,
    trendCells: 0,
    promptCount: promptIds.size,
    surfaceCount: surfaces.length,
    entitySetChanged,
  };
  if (shared.size < MIN_CELLS) {
    return { ...base, status: 'thin-overlap', events: [] };
  }

  const events: ChangeEvent[] = [];

  const brandRate = (
    key: 'mentioned' | 'cited',
    type: ChangeType,
    label: string,
    tail: { up: string; down: string },
  ) => {
    const c = cellRate(cur, brand.id, key);
    const p = cellRate(prev, brand.id, key);
    if (c !== null && p !== null && Math.abs(c - p) >= RATE_PP) {
      events.push(
        shareEvent(
          type,
          'shift',
          'overall',
          brand.name,
          label,
          c,
          p,
          true,
          tail,
        ),
      );
      return;
    }
    for (const surface of surfaces) {
      if ((cellsBySurface.get(surface) ?? 0) < MIN_CELLS) {
        continue;
      }
      const cs = cellRate(
        cur.filter((r) => r.surface === surface),
        brand.id,
        key,
      );
      const ps = cellRate(
        prev.filter((r) => r.surface === surface),
        brand.id,
        key,
      );
      if (cs !== null && ps !== null && Math.abs(cs - ps) >= RATE_PP) {
        events.push(
          shareEvent(
            type,
            'shift',
            surface,
            brand.name,
            label,
            cs,
            ps,
            true,
            tail,
          ),
        );
      }
    }
  };

  brandRate('mentioned', 'mention_rate', 'Mention rate', {
    up: 'What is driving the gain?',
    down: 'What drove the drop?',
  });
  brandRate('cited', 'citation_rate', 'Citation rate', {
    up: 'Which new sources are citing the brand?',
    down: 'Which citations were lost?',
  });

  const negC = negativeShare(cur, brand.id);
  const negP = negativeShare(prev, brand.id);
  const posC = positiveShare(cur, brand.id);
  const posP = positiveShare(prev, brand.id);
  if (negC !== null && negP !== null && posC !== null && posP !== null) {
    const posDelta = posC - posP;
    const negDelta = negC - negP;
    // One event per shift: a tone change usually moves both shares, and
    // reporting it twice would double-count the same fact.
    const useNegative = Math.abs(negDelta) > Math.abs(posDelta);
    const delta = useNegative ? negDelta : posDelta;
    if (Math.abs(delta) >= SENTIMENT_PP) {
      events.push(
        shareEvent(
          'sentiment',
          'shift',
          'overall',
          brand.name,
          useNegative ? 'Negative sentiment share' : 'Positive sentiment share',
          useNegative ? negC : posC,
          useNegative ? negP : posP,
          !useNegative,
          useNegative
            ? {
                up: 'Which answers turned negative?',
                down: 'Which answers softened?',
              }
            : {
                up: 'Which answers improved?',
                down: 'Which answers changed tone?',
              },
        ),
      );
    }
  }

  if (!entitySetChanged) {
    const cSov = shareOf(pooledSov(cur, 'mentioned'), brand.id);
    const pSov = shareOf(pooledSov(prev, 'mentioned'), brand.id);
    if (cSov !== null && pSov !== null && Math.abs(cSov - pSov) >= SOV_PP) {
      events.push(
        shareEvent(
          'sov',
          'shift',
          'overall',
          brand.name,
          'Share of voice',
          cSov,
          pSov,
          true,
          {
            up: 'Who lost ground?',
            down: 'Which competitors gained?',
          },
        ),
      );
    }

    const cPos = avgPosition(cur, brand.id);
    const pPos = avgPosition(prev, brand.id);
    if (
      cPos !== null &&
      pPos !== null &&
      positionedCount(cur, brand.id) >= MIN_CONDITIONAL_N &&
      positionedCount(prev, brand.id) >= MIN_CONDITIONAL_N &&
      Math.abs(cPos - pPos) >= POSITION_RANKS
    ) {
      events.push(positionEvent('shift', brand.name, cPos, pPos));
    }

    // Rises only: a competitor showing up where it wasn't is the alert; a
    // competitor fading is visible in the dashboard without an alarm.
    for (const entity of allEntities) {
      if (entity.isBrand) {
        continue;
      }
      const c = cellRate(cur, entity.id, 'mentioned');
      const p = cellRate(prev, entity.id, 'mentioned');
      if (c !== null && p !== null && c - p >= RATE_PP) {
        events.push(
          shareEvent(
            'competitor',
            'shift',
            'overall',
            entity.name,
            `${entity.name} mention rate`,
            c,
            p,
            false,
            {
              up: 'Where is it newly appearing?',
              down: 'Where did it fade?',
            },
          ),
        );
      }
    }
  }

  events.sort((a, b) => b.severity - a.severity);
  return { ...base, status: 'ok', events: events.slice(0, MAX_EVENTS) };
};

// One overall metric watched across the whole trend span. Per-surface drift
// is deliberately absent: a four-week trend read off a quarter of the cells
// is a shape found by looking, not a change worth an alert.
interface TrendMetric {
  type: ChangeType;
  entity: string;
  label: string;
  threshold: number;
  goodWhenUp: boolean;
  relative: boolean;
  risesOnly: boolean;
  tail: { up: string; down: string };
  value: (rows: ScoreRow[]) => number | null;
}

const trendMetrics = (
  allEntities: EntityInfo[],
  brand: EntityInfo,
): TrendMetric[] => [
  {
    type: 'mention_rate',
    entity: brand.name,
    label: 'Mention rate',
    threshold: RATE_PP,
    goodWhenUp: true,
    relative: false,
    risesOnly: false,
    tail: { up: 'What is driving the gain?', down: 'What drove the decline?' },
    value: (rows) => cellRate(rows, brand.id, 'mentioned'),
  },
  {
    type: 'citation_rate',
    entity: brand.name,
    label: 'Citation rate',
    threshold: RATE_PP,
    goodWhenUp: true,
    relative: false,
    risesOnly: false,
    tail: {
      up: 'Which sources started citing the brand?',
      down: 'Which citations were lost along the way?',
    },
    value: (rows) => cellRate(rows, brand.id, 'cited'),
  },
  {
    type: 'sentiment',
    entity: brand.name,
    label: 'Negative sentiment share',
    threshold: SENTIMENT_PP,
    goodWhenUp: false,
    relative: false,
    risesOnly: false,
    tail: {
      up: 'Which answers turned negative?',
      down: 'Which answers softened?',
    },
    value: (rows) => negativeShare(rows, brand.id),
  },
  {
    type: 'sov',
    entity: brand.name,
    label: 'Share of voice',
    threshold: SOV_PP,
    goodWhenUp: true,
    relative: true,
    risesOnly: false,
    tail: { up: 'Who lost ground?', down: 'Which competitors gained?' },
    value: (rows) => shareOf(pooledSov(rows, 'mentioned'), brand.id),
  },
  ...allEntities
    .filter((e) => !e.isBrand)
    .map((e) => ({
      type: 'competitor' as ChangeType,
      entity: e.name,
      label: `${e.name} mention rate`,
      threshold: RATE_PP,
      goodWhenUp: false,
      relative: true,
      risesOnly: true,
      tail: {
        up: 'Where is it gaining ground?',
        down: 'Where did it fade?',
      },
      value: (rows: ScoreRow[]) => cellRate(rows, e.id, 'mentioned'),
    })),
];

// A series counts as one movement when no step contradicts the overall
// direction by more than the tolerance. Strict monotonicity would discard a
// real slide for one flat week; allowing any shape would call a bounce a
// trend.
const isSustained = (series: number[], tolerance: number): boolean => {
  const total = (series.at(-1) ?? 0) - (series[0] ?? 0);
  if (total === 0) {
    return false;
  }
  const sign = Math.sign(total);
  return series.every(
    (v, i) => i === 0 || (v - (series[i - 1] ?? 0)) * sign >= -tolerance,
  );
};

export const detectDrift = (
  windows: WindowSlice[],
  allEntities: EntityInfo[],
  brand: EntityInfo,
): { cells: number; events: ChangeEvent[] } => {
  if (windows.length < TREND_WINDOWS) {
    return { cells: 0, events: [] };
  }
  const shared = sharedCells(windows);
  if (shared.size < MIN_CELLS) {
    return { cells: shared.size, events: [] };
  }
  const scoped = windows.map((w) =>
    w.rows.filter((r) => shared.has(cellKey(r))),
  );
  const entitySetChanged = setChangedAcross(windows);
  const events: ChangeEvent[] = [];

  for (const metric of trendMetrics(allEntities, brand)) {
    if (metric.relative && entitySetChanged) {
      continue;
    }
    const series = scoped.map(metric.value);
    if (series.some((v) => v === null)) {
      continue;
    }
    const values = series as number[];
    const first = values[0] ?? 0;
    const last = values.at(-1) ?? 0;
    const delta = last - first;
    if (Math.abs(delta) < metric.threshold) {
      continue;
    }
    if (metric.risesOnly && delta < 0) {
      continue;
    }
    if (!isSustained(values, metric.threshold * DRIFT_TOLERANCE)) {
      continue;
    }
    events.push(
      shareEvent(
        metric.type,
        'drift',
        'overall',
        metric.entity,
        metric.label,
        last,
        first,
        metric.goodWhenUp,
        metric.tail,
      ),
    );
  }

  if (!entitySetChanged) {
    const positions = scoped.map((rows) =>
      positionedCount(rows, brand.id) >= MIN_CONDITIONAL_N
        ? avgPosition(rows, brand.id)
        : null,
    );
    if (!positions.some((v) => v === null)) {
      const values = positions as number[];
      const first = values[0] ?? 0;
      const last = values.at(-1) ?? 0;
      if (
        Math.abs(last - first) >= POSITION_RANKS &&
        isSustained(values, POSITION_RANKS * DRIFT_TOLERANCE)
      ) {
        events.push(positionEvent('drift', brand.name, last, first));
      }
    }
  }
  return { cells: shared.size, events };
};

// A metric that both broke this week and slid all month is one story. Keep
// the larger reading of it — usually the drift, which spans more ground — and
// never list the same subject twice.
export const mergeEvents = (
  shift: ChangeEvent[],
  drift: ChangeEvent[],
): ChangeEvent[] => {
  const byKey = new Map<string, ChangeEvent>();
  for (const event of [...shift, ...drift]) {
    const key = `${event.type}:${event.scope}:${event.entity}`;
    const held = byKey.get(key);
    if (!held || event.severity > held.severity) {
      byKey.set(key, event);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.severity - a.severity)
    .slice(0, MAX_EVENTS);
};

// Windows are anchored on the newest completed run, not on today: a skipped
// cron day should shorten a window, never slide every boundary.
const shiftDate = (date: string, days: number): string => {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
};

export const loadWindows = async (
  db: Db,
  workspaceId: number,
  count = TREND_WINDOWS,
): Promise<WindowSlice[]> => {
  // Completed runs only: a run that is still filling in would read its
  // missing cells as absence.
  const [newest] = await db
    .select({ date: runs.date })
    .from(runs)
    .where(and(eq(runs.workspaceId, workspaceId), eq(runs.status, 'complete')))
    .orderBy(desc(runs.date))
    .limit(1);
  if (!newest) {
    return [];
  }
  const span = WINDOW_DAYS * count;
  const from = shiftDate(newest.date, -(span - 1));
  const rows = await loadScoreRows(db, workspaceId, from);

  const slices: WindowSlice[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const end = shiftDate(newest.date, -(WINDOW_DAYS * i));
    const start = shiftDate(end, -(WINDOW_DAYS - 1));
    const inWindow = rows.filter((r) => r.date >= start && r.date <= end);
    if (inWindow.length === 0) {
      continue;
    }
    const dates = [...new Set(inWindow.map((r) => r.date))].sort();
    const hashes = new Set(inWindow.map((r) => r.entitySetHash));
    slices.push({
      window: {
        from: dates[0] ?? start,
        to: dates.at(-1) ?? end,
        runs: new Set(inWindow.map((r) => r.runId)).size,
        answers: answerCount(inWindow),
        entitySetHash: hashes.size === 1 ? ([...hashes][0] ?? null) : null,
      },
      rows: inWindow,
    });
  }
  return slices;
};

// Null only when the workspace has no brand yet (needsSetup).
export const buildChangeReport = async (
  db: Db,
  workspaceId: number,
): Promise<ChangeReport | null> => {
  const { entities: allEntities, brand } = await loadEntitiesWithBrand(
    db,
    workspaceId,
  );
  if (!brand) {
    return null;
  }
  const windows = await loadWindows(db, workspaceId);
  const latest = windows.at(-1);
  const previous = windows.at(-2);
  if (!latest || !previous) {
    return {
      status: 'needs-runs',
      windowDays: WINDOW_DAYS,
      latest: null,
      previous: null,
      trend: [],
      cells: 0,
      trendCells: 0,
      promptCount: 0,
      surfaceCount: 0,
      entitySetChanged: false,
      events: [],
    };
  }
  const report = detectChanges(latest, previous, allEntities, brand);
  const drift = detectDrift(windows, allEntities, brand);
  return {
    ...report,
    trend: windows.map((w) => w.window),
    trendCells: drift.cells,
    events:
      report.status === 'ok'
        ? mergeEvents(report.events, drift.events)
        : report.events,
  };
};

export const changesRoutes = new Hono<WorkspaceBindings>();

changesRoutes.get('/', async (c) => {
  const report = await buildChangeReport(getDb(c.env), c.get('workspace').id);
  if (!report) {
    return c.json({ needsSetup: true });
  }
  return c.json(report);
});
