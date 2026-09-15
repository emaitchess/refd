import { ChatExchange } from './chat/exchange-do';
import type { AppEnv } from './env';
import { handleIngestBatch } from './ingest/consumer';
import { resumePendingRunDispatches } from './ingest/dispatch';
import type { IngestMessage } from './ingest/messages';
import { runScheduledWorkspaces } from './ingest/scheduled-runs';
import { oauthFetch } from './oauth/provider';

// Durable Object classes must be exported from the Worker entrypoint.
export { ChatExchange };

// The schedule tick: fires each eligible workspace due per its run schedule
// (workspaces.schedule; null = the default daily 06:00 UTC).
const SCHEDULE_TICK_CRON = '*/15 * * * *';

export default {
  // API-only Worker (api.refd.ai): API, OAuth, and MCP. The SPA and the public
  // site are served by their own Workers; homepage Markdown negotiation moves
  // to the website Worker.
  fetch: (
    request: Request,
    env: AppEnv,
    ctx: ExecutionContext,
  ): Promise<Response> => oauthFetch(request, env, ctx),

  async scheduled(controller: ScheduledController, env: AppEnv): Promise<void> {
    try {
      const resumed = await resumePendingRunDispatches(env);
      if (resumed.length > 0) {
        console.log(
          JSON.stringify({
            message: 'scheduled run dispatch recovery completed',
            runs: resumed,
          }),
        );
      }
    } catch (error) {
      console.error('scheduled run dispatch recovery failed', error);
    }
    if (controller.cron !== SCHEDULE_TICK_CRON) {
      return;
    }
    await runScheduledWorkspaces(env);
  },

  async queue(batch: MessageBatch<IngestMessage>, env: AppEnv): Promise<void> {
    await handleIngestBatch(batch, env);
  },
} satisfies ExportedHandler<AppEnv, IngestMessage>;
