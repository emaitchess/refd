import { scheduledMonitoringEligible } from '@refd/core/workspaces';
import { getDb } from './db/client';
import { workspaces } from './db/schema';
import type { AppEnv } from './env';
import { handleIngestBatch } from './ingest/consumer';
import type { IngestMessage } from './ingest/messages';
import { createRun } from './ingest/runs';
import { oauthFetch } from './oauth/provider';

export default {
  // API-only Worker (api.refd.ai): API, OAuth, and MCP. The SPA and the public
  // site are served by their own Workers; homepage Markdown negotiation moves
  // to the website Worker.
  fetch: (
    request: Request,
    env: AppEnv,
    ctx: ExecutionContext,
  ): Promise<Response> => oauthFetch(request, env, ctx),

  async scheduled(
    _controller: ScheduledController,
    env: AppEnv,
  ): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const candidates = await getDb(env)
      .select({
        id: workspaces.id,
        monitoringTier: workspaces.monitoringTier,
        monitoringEndsAt: workspaces.monitoringEndsAt,
      })
      .from(workspaces);
    const eligibleWorkspaces = candidates.filter((workspace) =>
      scheduledMonitoringEligible(
        workspace,
        env.SCHEDULED_MONITORING_POLICY,
        now,
      ),
    );
    for (const ws of eligibleWorkspaces) {
      try {
        const { runId, created } = await createRun(
          env,
          ws.id,
          'cron',
          `cron:${ws.id}:${date}`,
          date,
        );
        console.log(
          created
            ? `cron: ws ${ws.id} run ${runId} started`
            : `cron: ws ${ws.id} already ran for ${date}`,
        );
      } catch (error) {
        // A workspace with no prompts (or a transient failure) must not
        // block the other workspaces' runs.
        console.error(`cron: ws ${ws.id} failed`, error);
      }
    }
  },

  async queue(batch: MessageBatch<IngestMessage>, env: AppEnv): Promise<void> {
    await handleIngestBatch(batch, env);
  },
} satisfies ExportedHandler<AppEnv, IngestMessage>;
