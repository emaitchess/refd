import { Hono } from 'hono';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { parseRange } from '../lib/range';
import {
  avgPosition,
  cellRate,
  firstMentionShare,
  listEntities,
  loadScoreRows,
  pooledSov,
  runSeries,
  sentimentDist,
  shareOf,
} from './metrics';

export const competitorRoutes = new Hono<WorkspaceBindings>();

competitorRoutes.get('/', async (c) => {
  const { range, from } = parseRange(c.req.query('range'));
  const db = getDb(c.env);
  const ws = c.get('workspace').id;

  const allEntities = await listEntities(db, ws);
  const rows = await loadScoreRows(db, ws, from);

  const mentionSov = pooledSov(rows, 'mentioned');
  const citedSov = pooledSov(rows, 'cited');
  const firstShares = firstMentionShare(rows);
  const surfaceList = [...new Set(rows.map((r) => r.surface))].sort();

  return c.json({
    range,
    entities: allEntities.map((entity) => ({
      ...entity,
      mentionRate: cellRate(rows, entity.id, 'mentioned'),
      citationRate: cellRate(rows, entity.id, 'cited'),
      sov: shareOf(mentionSov, entity.id),
      citationSov: shareOf(citedSov, entity.id),
      avgPosition: avgPosition(rows, entity.id),
      firstMentionShare: shareOf(firstShares, entity.id),
      sentiment: sentimentDist(rows, entity.id),
      surfaces: surfaceList.map((s) => ({
        surface: s,
        mentionRate: cellRate(
          rows.filter((r) => r.surface === s),
          entity.id,
          'mentioned',
        ),
      })),
    })),
    series: runSeries(
      rows,
      allEntities.map((e) => e.id),
    ),
  });
});
