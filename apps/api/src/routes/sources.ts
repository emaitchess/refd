import { and, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { WorkspaceBindings } from '../auth/middleware';
import { getDb } from '../db/client';
import { citations, entityScores, results, runs } from '../db/schema';
import { parseRange } from '../lib/range';
import { loadEntitiesWithBrand } from './metrics';

export const sourceRoutes = new Hono<WorkspaceBindings>();

sourceRoutes.get('/', async (c) => {
  const { range, from } = parseRange(c.req.query('range'));
  const db = getDb(c.env);
  const ws = c.get('workspace').id;

  const { brand } = await loadEntitiesWithBrand(db, ws);
  if (!brand) {
    return c.json({ needsSetup: true });
  }

  const inRange = and(
    eq(results.ok, true),
    gte(runs.date, from),
    eq(runs.workspaceId, ws),
  );

  // Registrable domains (PSL grouping) ranked by how many answers cite them.
  // Unattributable citations (opaque redirects, registrableDomain null) are
  // counted separately below — never credited to a domain.
  const domains = await db
    .select({
      domain: citations.registrableDomain,
      // Attribution via the v2 entity link; "ours" = the brand entity.
      isOurs: sql<number>`max(case when ${citations.entityId} = ${brand.id} then 1 else 0 end)`,
      citationCount: sql<number>`count(*)`,
      resultCount: sql<number>`count(distinct ${citations.resultId})`,
    })
    .from(citations)
    .innerJoin(results, eq(citations.resultId, results.id))
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(and(inRange, isNotNull(citations.registrableDomain)))
    .groupBy(citations.registrableDomain)
    .orderBy(sql`count(distinct ${citations.resultId}) desc`)
    .limit(100);

  const unattributable = await db
    .select({ citationCount: sql<number>`count(*)` })
    .from(citations)
    .innerJoin(results, eq(citations.resultId, results.id))
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(and(inRange, sql`${citations.registrableDomain} is null`));

  // The brand's cited URLs with frequency.
  const ourUrls = await db
    .select({
      url: citations.url,
      count: sql<number>`count(*)`,
    })
    .from(citations)
    .innerJoin(results, eq(citations.resultId, results.id))
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(and(inRange, eq(citations.entityId, brand.id)))
    .groupBy(citations.url)
    .orderBy(sql`count(*) desc`)
    .limit(100);

  // Source gap: domains AI cites in answers where the brand is absent
  // (neither mentioned nor cited) — the "go get mentioned there" list.
  const gap = await db
    .select({
      domain: citations.registrableDomain,
      resultCount: sql<number>`count(distinct ${citations.resultId})`,
    })
    .from(citations)
    .innerJoin(results, eq(citations.resultId, results.id))
    .innerJoin(runs, eq(results.runId, runs.id))
    .innerJoin(
      entityScores,
      and(
        eq(entityScores.resultId, results.id),
        eq(entityScores.entityId, brand.id),
      ),
    )
    .where(
      and(
        inRange,
        isNotNull(citations.registrableDomain),
        or(
          sql`${citations.entityId} is null`,
          sql`${citations.entityId} != ${brand.id}`,
        ),
        eq(entityScores.mentioned, false),
        eq(entityScores.cited, false),
      ),
    )
    .groupBy(citations.registrableDomain)
    .orderBy(sql`count(distinct ${citations.resultId}) desc`)
    .limit(50);

  return c.json({
    range,
    // registrableDomain is non-null by the isNotNull filter; coalesce for the type.
    domains: domains.map((d) => ({
      ...d,
      domain: d.domain ?? '',
      isOurs: d.isOurs === 1,
    })),
    unattributable: unattributable[0]?.citationCount ?? 0,
    ourUrls,
    gap: gap.map((g) => ({ ...g, domain: g.domain ?? '' })),
  });
});
