// Change alerts: what materially moved between the last two completed runs.
// Derived on read from the same score atoms as every other metric — nothing
// is stored, so a rescore corrects what the card says the next time anyone
// looks. Three honesty guards: runs are compared only over their shared
// (prompt × surface) cells, so a subset run can never fabricate a drop;
// set-relative metrics (SOV, position, competitor movement) are suppressed
// when the tracked entity set changed between the runs; and deltas under the
// material thresholds stay silent — SAMPLES=2 answers are non-deterministic,
// so small moves are noise, not news.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { SURFACE_ORDER, surfaceLabel } from '../../shared/surfaces';
import type { WorkspaceBindings } from '../auth/middleware';
import { type Db, getDb } from '../db/client';
import { entityScores, results, runs } from '../db/schema';
import {
  avgPosition,
  cellRate,
  type EntityInfo,
  loadEntitiesWithBrand,
  pooledSov,
  type ScoreRow,
  sentimentDist,
  shareOf,
} from './metrics';

// Material-delta thresholds. Shares move on the 0..1 scale (0.15 = 15
// percentage points); position moves in ranks. The glossary entry
// (metric-copy.ts "materialChange") states these numbers in prose — the
// changes tests pin the two together so tuning one updates the other.
export const RATE_PP = 0.15;
export const SOV_PP = 0.1;
export const SENTIMENT_PP = 0.2;
export const POSITION_RANKS = 1;
// A comparison thinner than this stays silent: a percentage swing over a
// couple of cells is sampling noise wearing a trend costume.
export const MIN_CELLS = 4;
// Position and sentiment are conditional metrics — they also need enough
// qualifying rows (positioned mentions / classified mentions) on both sides.
export const MIN_CONDITIONAL_N = 3;
const MAX_EVENTS = 6;

export type ChangeType =
  | 'mention_rate'
  | 'citation_rate'
  | 'sov'
  | 'position'
  | 'sentiment'
  | 'competitor';

export interface ChangeEvent {
  type: ChangeType;
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
  headline: string;
  // The same fact phrased as a question the Home agent can be asked — the
  // Overview "ask" affordance and the idle chips both use it verbatim.
  question: string;
}

export interface RunRef {
  runId: number;
  date: string;
  trigger: string;
  entitySetHash: string | null;
}

export interface RunSlice {
  run: RunRef;
  rows: ScoreRow[];
}

export interface ChangeReport {
  status: 'ok' | 'needs-runs' | 'thin-overlap';
  latest: RunRef | null;
  previous: RunRef | null;
  // The compared scope: shared (prompt × surface) cells between the two runs.
  cells: number;
  promptCount: number;
  surfaceCount: number;
  entitySetChanged: boolean;
  events: ChangeEvent[];
}

const ppText = (delta: number): string =>
  `${Math.abs(Math.round(delta * 100))} pts`;
const pctText = (v: number): string => `${Math.round(v * 100)}%`;
const rankText = (v: number): string => `#${v.toFixed(1)}`;

const shareEvent = (
  type: ChangeType,
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
  return {
    type,
    scope,
    entity,
    direction,
    good: direction === 'up' ? goodWhenUp : !goodWhenUp,
    unit: 'share',
    current,
    previous,
    delta,
    severity: Math.abs(delta),
    headline: `${label}${where} ${verb} ${ppText(delta)}`,
    question: `${label}${where} ${verb} from ${pctText(previous)} to ${pctText(current)} between the last two runs. ${tail[direction]}`,
  };
};

const positionEvent = (
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
    scope: 'overall',
    entity,
    direction,
    // Position counts up as it worsens: a lower number is the good direction.
    good: direction === 'down',
    unit: 'rank',
    current,
    previous,
    delta,
    // One rank weighs like a threshold-level rate move, so mixed sorts stay
    // sane.
    severity: Math.abs(delta) * RATE_PP,
    headline: `Average position ${verb} ${ranksText}`,
    question: `Average position ${verb} from ${rankText(previous)} to ${rankText(current)} between the last two runs. ${
      direction === 'up'
        ? 'Which answers pushed the brand down the order?'
        : 'What is driving the earlier mentions?'
    }`,
  };
};

export const detectChanges = (
  latest: RunSlice,
  previous: RunSlice,
  allEntities: EntityInfo[],
  brand: EntityInfo,
): ChangeReport => {
  const cellKey = (r: ScoreRow) => `${r.promptId}:${r.surface}`;
  const latestCells = new Set(latest.rows.map(cellKey));
  const shared = new Set(
    previous.rows.map(cellKey).filter((k) => latestCells.has(k)),
  );
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
  // A null hash (legacy imports) can't prove the sets match — treat it as
  // changed and keep the relative metrics quiet.
  const entitySetChanged =
    latest.run.entitySetHash === null ||
    previous.run.entitySetHash === null ||
    latest.run.entitySetHash !== previous.run.entitySetHash;

  const base = {
    latest: latest.run,
    previous: previous.run,
    cells: shared.size,
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
        shareEvent(type, 'overall', brand.name, label, c, p, true, tail),
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
          shareEvent(type, surface, brand.name, label, cs, ps, true, tail),
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

  const dc = sentimentDist(cur, brand.id);
  const dp = sentimentDist(prev, brand.id);
  if (dc !== null && dp !== null) {
    const nC = dc.positive + dc.neutral + dc.negative;
    const nP = dp.positive + dp.neutral + dp.negative;
    if (nC >= MIN_CONDITIONAL_N && nP >= MIN_CONDITIONAL_N) {
      const posDelta = dc.positive / nC - dp.positive / nP;
      const negDelta = dc.negative / nC - dp.negative / nP;
      // One event per shift: a tone change usually moves both shares, and
      // reporting it twice would double-count the same fact.
      const useNegative = Math.abs(negDelta) > Math.abs(posDelta);
      const delta = useNegative ? negDelta : posDelta;
      if (Math.abs(delta) >= SENTIMENT_PP) {
        events.push(
          shareEvent(
            'sentiment',
            'overall',
            brand.name,
            useNegative
              ? 'Negative sentiment share'
              : 'Positive sentiment share',
            useNegative ? dc.negative / nC : dc.positive / nC,
            useNegative ? dp.negative / nP : dp.positive / nP,
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
  }

  if (!entitySetChanged) {
    const cSov = shareOf(pooledSov(cur, 'mentioned'), brand.id);
    const pSov = shareOf(pooledSov(prev, 'mentioned'), brand.id);
    if (cSov !== null && pSov !== null && Math.abs(cSov - pSov) >= SOV_PP) {
      events.push(
        shareEvent(
          'sov',
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

    const positioned = (rows: ScoreRow[]) =>
      rows.filter((r) => r.entityId === brand.id && r.position !== null).length;
    const cPos = avgPosition(cur, brand.id);
    const pPos = avgPosition(prev, brand.id);
    if (
      cPos !== null &&
      pPos !== null &&
      positioned(cur) >= MIN_CONDITIONAL_N &&
      positioned(prev) >= MIN_CONDITIONAL_N &&
      Math.abs(cPos - pPos) >= POSITION_RANKS
    ) {
      events.push(positionEvent(brand.name, cPos, pPos));
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

export const loadLatestRunPair = async (
  db: Db,
  workspaceId: number,
): Promise<{ latest: RunSlice; previous: RunSlice } | null> => {
  // Completed runs only: comparing against a run that is still filling in
  // would read its missing cells as absence.
  const pair = await db
    .select({
      id: runs.id,
      date: runs.date,
      trigger: runs.trigger,
      entitySetHash: runs.entitySetHash,
    })
    .from(runs)
    .where(and(eq(runs.workspaceId, workspaceId), eq(runs.status, 'complete')))
    .orderBy(desc(runs.id))
    .limit(2);
  const [a, b] = pair;
  if (!a || !b) {
    return null;
  }
  const rows: ScoreRow[] = await db
    .select({
      runId: results.runId,
      date: runs.date,
      entitySetHash: runs.entitySetHash,
      promptId: results.promptId,
      surface: results.surface,
      sample: results.sample,
      entityId: entityScores.entityId,
      mentioned: entityScores.mentioned,
      cited: entityScores.cited,
      position: entityScores.position,
      prominence: entityScores.prominence,
      sentiment: entityScores.sentiment,
    })
    .from(entityScores)
    .innerJoin(results, eq(entityScores.resultId, results.id))
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(
      and(
        eq(results.ok, true),
        eq(results.answerPresent, true),
        inArray(results.runId, [a.id, b.id]),
      ),
    );
  const slice = (r: typeof a): RunSlice => ({
    run: {
      runId: r.id,
      date: r.date,
      trigger: r.trigger,
      entitySetHash: r.entitySetHash,
    },
    rows: rows.filter((row) => row.runId === r.id),
  });
  return { latest: slice(a), previous: slice(b) };
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
  const pair = await loadLatestRunPair(db, workspaceId);
  if (!pair) {
    return {
      status: 'needs-runs',
      latest: null,
      previous: null,
      cells: 0,
      promptCount: 0,
      surfaceCount: 0,
      entitySetChanged: false,
      events: [],
    };
  }
  return detectChanges(pair.latest, pair.previous, allEntities, brand);
};

export const changesRoutes = new Hono<WorkspaceBindings>();

changesRoutes.get('/', async (c) => {
  const report = await buildChangeReport(getDb(c.env), c.get('workspace').id);
  if (!report) {
    return c.json({ needsSetup: true });
  }
  return c.json(report);
});
