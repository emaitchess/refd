import {
  DEFAULT_RUN_SCHEDULE,
  dueScheduledRunDate,
  parseRunSchedule,
} from '@refd/core/schedule';
import { scheduledMonitoringEligible } from '@refd/core/workspaces';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { runs, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import { createRun } from './runs';

// Each 15-minute schedule tick: fire every eligible workspace whose scheduled
// time has arrived and whose run for that UTC date does not exist yet. The
// per-date run key caps a schedule at one run per day; the pre-check keeps
// later ticks of the same day from re-resuming an already-created run.
export const runScheduledWorkspaces = async (env: AppEnv): Promise<void> => {
  const db = getDb(env);
  const now = Date.now();
  const candidates = await db
    .select({
      id: workspaces.id,
      schedule: workspaces.schedule,
      monitoringTier: workspaces.monitoringTier,
      monitoringEndsAt: workspaces.monitoringEndsAt,
    })
    .from(workspaces);
  const eligible = candidates.filter((workspace) =>
    scheduledMonitoringEligible(
      workspace,
      env.SCHEDULED_MONITORING_POLICY,
      now,
    ),
  );
  for (const workspace of eligible) {
    try {
      const schedule =
        parseRunSchedule(workspace.schedule) ?? DEFAULT_RUN_SCHEDULE;
      if (!schedule.enabled) {
        continue;
      }
      const date = dueScheduledRunDate(schedule, now);
      if (!date) {
        continue;
      }
      const key = `cron:${workspace.id}:${date}`;
      const existing = await db
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.key, key))
        .limit(1);
      if (existing[0]) {
        continue;
      }
      const { runId, created, dispatchState } = await createRun(
        env,
        workspace.id,
        'cron',
        key,
        date,
      );
      console.log(
        created
          ? `cron: ws ${workspace.id} run ${runId} ${dispatchState}`
          : `cron: ws ${workspace.id} run ${runId} already exists (${dispatchState})`,
      );
    } catch (error) {
      // A workspace with no prompts (or a transient failure) must not block
      // the other workspaces' runs.
      console.error(`cron: ws ${workspace.id} failed`, error);
    }
  }
};
