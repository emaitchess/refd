import { Hono } from 'hono';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { parseRange } from '../lib/range';
import {
  answerCount,
  avgPosition,
  cellRate,
  coverageStats,
  firstMentionShare,
  loadCoverageRows,
  loadEntitiesWithBrand,
  loadScoreRows,
  pooledSov,
  prominenceDist,
  runSeries,
  type ScoreRow,
  sentimentDist,
  shareOf,
} from './metrics';

export const overviewRoutes = new Hono<WorkspaceBindings>();

overviewRoutes.get('/', async (c) => {
  const { range, from, prevFrom, prevTo } = parseRange(c.req.query('range'));
  const db = getDb(c.env);
  const ws = c.get('workspace').id;

  const { entities: allEntities, brand } = await loadEntitiesWithBrand(db, ws);
  if (!brand) {
    // Workspace not set up yet — the client guard sends these to onboarding.
    return c.json({ needsSetup: true });
  }
  // SOV over a brand-only set is a meaningless 100% — suppressed until the
  // workspace tracks a competitor.
  const hasCompetitors = allEntities.some((e) => !e.isBrand);

  const [rows, prevRows, covRows] = await Promise.all([
    loadScoreRows(db, ws, from),
    range === 'all'
      ? Promise.resolve([] as ScoreRow[])
      : loadScoreRows(db, ws, prevFrom, prevTo),
    loadCoverageRows(db, ws, from),
  ]);

  const tile = (scope: ScoreRow[]) => {
    if (scope.length === 0) {
      return null;
    }
    return {
      mentionRate: cellRate(scope, brand.id, 'mentioned'),
      citationRate: cellRate(scope, brand.id, 'cited'),
      sov: hasCompetitors
        ? shareOf(pooledSov(scope, 'mentioned'), brand.id)
        : null,
      citationSov: hasCompetitors
        ? shareOf(pooledSov(scope, 'cited'), brand.id)
        : null,
      avgPosition: avgPosition(scope, brand.id),
      firstMentionShare: shareOf(firstMentionShare(scope), brand.id),
      answers: answerCount(scope),
    };
  };

  // Brand per surface: rates + conditional position, from the same atom pool.
  const surfaces = [...new Set(rows.map((r) => r.surface))].sort().map((s) => {
    const scope = rows.filter((r) => r.surface === s);
    return {
      surface: s,
      mentionRate: cellRate(scope, brand.id, 'mentioned'),
      citationRate: cellRate(scope, brand.id, 'cited'),
      avgPosition: avgPosition(scope, brand.id),
      answers: answerCount(scope),
    };
  });

  return c.json({
    range,
    entities: allEntities,
    brandId: brand.id,
    hasCompetitors,
    tiles: { current: tile(rows), previous: tile(prevRows) },
    prominence: prominenceDist(rows, brand.id),
    sentiment: sentimentDist(rows, brand.id),
    coverage: coverageStats(covRows),
    series: runSeries(
      rows,
      allEntities.map((e) => e.id),
    ),
    surfaces,
  });
});
