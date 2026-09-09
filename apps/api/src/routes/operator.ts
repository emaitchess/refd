import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthedBindings } from '../auth/middleware';
import { requireOperator } from '../auth/operator';
import { getDb } from '../db/client';
import {
  results,
  runs,
  setupCommits,
  setupUsage,
  snapshots,
} from '../db/schema';
import { resetAndResumeRunDispatch } from '../ingest/dispatch';
import { parseBody, parseId } from '../lib/http';
import { singleLineText } from '../lib/sanitize';
import { releaseReportClaim } from '../onboarding/budget';

interface OperatorRouteDependencies {
  resetAndResumeRunDispatch: typeof resetAndResumeRunDispatch;
}

const reasonSchema = z.object({ reason: singleLineText(4, 500) });

export const createOperatorRoutes = (
  dependencies: OperatorRouteDependencies = { resetAndResumeRunDispatch },
) => {
  const routes = new Hono<AuthedBindings>();

  routes.use(requireOperator);

  routes.post('/runs/:id/resume-dispatch', async (c) => {
    const runId = parseId(c.req.param('id'));
    if (runId === null) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const result = await dependencies.resetAndResumeRunDispatch(c.env, runId);
    if (!result) {
      return c.json({ error: 'not found' }, 404);
    }
    if (result.state === 'legacy' || result.expectedMessages === null) {
      return c.json({ error: 'run has no recoverable dispatch plan' }, 409);
    }
    return c.json(result);
  });

  const loadCommit = async (env: AuthedBindings['Bindings'], setupId: number) =>
    (
      await getDb(env)
        .select()
        .from(setupCommits)
        .where(eq(setupCommits.id, setupId))
    )[0];

  const runIdsOf = (commit: typeof setupCommits.$inferSelect): number[] =>
    [commit.preliminaryRunId, commit.backgroundRunId].flatMap((id) =>
      id === null ? [] : [id],
    );

  routes.post('/setup-commits/:id/resume-dispatch', async (c) => {
    const setupId = parseId(c.req.param('id'));
    if (setupId === null) {
      return c.json({ error: 'invalid id' }, 400);
    }
    await parseBody(c, reasonSchema);
    const db = getDb(c.env);
    const commit = await loadCommit(c.env, setupId);
    if (!commit) {
      return c.json({ error: 'not found' }, 404);
    }
    if (commit.claimStatus !== 'active') {
      return c.json({ error: 'setup commit is void' }, 409);
    }
    const runIds = runIdsOf(commit);
    const resumed = [];
    for (const runId of runIds) {
      const result = await dependencies.resetAndResumeRunDispatch(c.env, runId);
      if (result && result.state !== 'legacy') {
        resumed.push(result);
      }
    }
    console.log(
      JSON.stringify({
        event: 'operator_setup_dispatch_resumed',
        setupId,
        operatorUserId: c.get('user').id,
        runIds,
      }),
    );
    return c.json({ resumed });
  });

  // Claim release only: allowed exclusively when dispatch state proves zero
  // queue acceptance and no stored provider data. Ambiguous or spent run
  // groups fail closed — the operator must resume them instead.
  routes.post('/setup-commits/:id/void-unspent', async (c) => {
    const setupId = parseId(c.req.param('id'));
    if (setupId === null) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const data = await parseBody(c, reasonSchema);
    const db = getDb(c.env);
    const commit = await loadCommit(c.env, setupId);
    if (!commit) {
      return c.json({ error: 'not found' }, 404);
    }
    if (commit.claimStatus !== 'active') {
      return c.json({ error: 'setup commit is already void' }, 409);
    }
    const runIds = runIdsOf(commit);
    if (runIds.length > 0) {
      const dispatchRows = await db
        .select({
          id: runs.id,
          startedAt: runs.dispatchStartedAt,
          cursor: runs.dispatchCursor,
        })
        .from(runs)
        .where(inArray(runs.id, runIds));
      const provableUnspent = dispatchRows.every(
        (row) => row.startedAt === null && row.cursor === 0,
      );
      if (!provableUnspent) {
        return c.json(
          { error: 'dispatch may have reached the queue; resume instead' },
          409,
        );
      }
      const snapshotCount = await db
        .select({ n: snapshots.id })
        .from(snapshots)
        .where(inArray(snapshots.runId, runIds));
      const resultCount = await db
        .select({ n: results.id })
        .from(results)
        .where(inArray(results.runId, runIds));
      if (snapshotCount.length > 0 || resultCount.length > 0) {
        return c.json(
          { error: 'provider data exists for this run group; resume instead' },
          409,
        );
      }
    }
    const claim = (
      await db
        .select({ id: setupUsage.id })
        .from(setupUsage)
        .where(
          and(
            eq(setupUsage.workspaceId, commit.workspaceId),
            eq(setupUsage.kind, 'report'),
          ),
        )
    )[0];
    const voided = await db
      .update(setupCommits)
      .set({
        claimStatus: 'void',
        voidedAt: Date.now(),
        voidedByUserId: c.get('user').id,
        voidReason: data.reason,
      })
      .where(
        and(
          eq(setupCommits.id, setupId),
          eq(setupCommits.claimStatus, 'active'),
        ),
      )
      .returning({ id: setupCommits.id });
    if (voided.length === 0) {
      return c.json({ error: 'setup commit is already void' }, 409);
    }
    if (claim) {
      await releaseReportClaim(db, {
        claimId: claim.id,
        userId: c.get('user').id,
        workspaceId: commit.workspaceId,
      });
    }
    console.log(
      JSON.stringify({
        event: 'operator_setup_void_unspent',
        setupId,
        operatorUserId: c.get('user').id,
        runIds,
        releasedClaimId: claim?.id ?? null,
        reason: data.reason,
      }),
    );
    return c.json({ ok: true, releasedClaimId: claim?.id ?? null });
  });

  return routes;
};

export const operatorRoutes = createOperatorRoutes();
