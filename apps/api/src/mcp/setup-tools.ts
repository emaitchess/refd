import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getDb } from '../db/client';
import type { AppEnv } from '../env';
import {
  MCP_SCOPE,
  MCP_WRITE_SCOPE,
  setupToolsEnabled,
} from '../oauth/constants';
import {
  brandRequestSchema,
  type OnboardingFailure,
  type OnboardingState,
  patchRequestSchema,
} from '../onboarding/contracts';
import { getSetupReport } from '../onboarding/report';
import {
  confirmSetup,
  draftDescription,
  loadOnboardingState,
  type OnboardingContext,
  previewSetup,
  saveBrand,
  suggestCompetitors,
  suggestPrompts,
  updateDraft,
} from '../onboarding/service';
import {
  McpAccessError,
  type McpPrincipal,
  resolveMcpPrincipal,
} from './context';

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

const errorResult = (body: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
  isError: true,
});

const accessDenied = () =>
  errorResult({
    error: {
      code: 'forbidden',
      message: 'This tool requires data:write on the connected workspace.',
    },
  });

const failureResult = (failure: OnboardingFailure) =>
  errorResult({ error: failure.error, status: failure.status });

// Mutations never accept a workspace id: the OAuth grant is the only source.
const contextFor = (
  env: AppEnv,
  principal: McpPrincipal,
): OnboardingContext => ({
  db: getDb(env),
  env,
  workspaceId: principal.workspaceId,
  workspaceName: principal.workspaceName,
  userId: principal.userId,
  userEmail: principal.userEmail,
  adminEmails: env.ADMIN_EMAILS,
});

const runSetupTool = async (
  env: AppEnv,
  executionContext: ExecutionContext,
  name: string,
  options: { requireWrite: boolean },
  operation: (principal: McpPrincipal) => Promise<unknown>,
) => {
  const startedAt = Date.now();
  try {
    const principal = await resolveMcpPrincipal(env, executionContext);
    if (options.requireWrite && !principal.scopes.includes(MCP_WRITE_SCOPE)) {
      console.log(
        JSON.stringify({
          event: 'mcp_tool_call',
          tool: name,
          clientId: principal.clientId,
          outcome: 'denied',
        }),
      );
      return accessDenied();
    }
    const value = await operation(principal);
    console.log(
      JSON.stringify({
        event: 'mcp_tool_call',
        tool: name,
        clientId: principal.clientId,
        connectionId: principal.connectionRowId,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
        durationMs: Date.now() - startedAt,
        outcome: 'ok',
      }),
    );
    return textResult(value);
  } catch (error) {
    const denied = error instanceof McpAccessError;
    console.error(
      JSON.stringify({
        event: 'mcp_tool_call',
        tool: name,
        durationMs: Date.now() - startedAt,
        outcome: denied ? 'denied' : 'error',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return errorResult({
      error: {
        code: denied ? 'forbidden' : 'setup_error',
        message:
          error instanceof Error ? error.message : 'The setup tool failed.',
      },
    });
  }
};

const unwrapState = (result: unknown): unknown => {
  const candidate = result as
    | OnboardingState
    | { state?: OnboardingState; ok?: boolean }
    | OnboardingFailure;
  if (candidate && typeof candidate === 'object' && 'error' in candidate) {
    return failureResult(candidate as OnboardingFailure);
  }
  return textResult(result);
};

// Registers the nine setup tools against a data:write grant. Only confirm_setup
// can trigger provider spend; generation tools claim the budget first; every
// mutation rides the same shared services as the dashboard.
export const registerSetupTools = (
  server: McpServer,
  env: AppEnv,
  executionContext: ExecutionContext,
): void => {
  if (!setupToolsEnabled(env)) {
    return;
  }
  const write = { requireWrite: true };
  const inspect = { requireWrite: false };

  server.registerTool(
    'get_setup_state',
    {
      title: 'Get onboarding setup state',
      description:
        'Returns the workspace setup wizard state: phase, editable draft, enabled surfaces, draft version, regeneration allowances, and commit state.',
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      runSetupTool(
        env,
        executionContext,
        'get_setup_state',
        inspect,
        async (principal) => loadOnboardingState(contextFor(env, principal)),
      ),
  );

  server.registerTool(
    'set_brand',
    {
      title: 'Set the tracked brand',
      description:
        'Sets or updates the workspace brand: name, domains, and aliases. Requires expectedVersion from the latest setup state.',
      inputSchema: brandRequestSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runSetupTool(
        env,
        executionContext,
        'set_brand',
        write,
        async (principal) =>
          unwrapState(await saveBrand(contextFor(env, principal), args)),
      ),
  );

  server.registerTool(
    'draft_description',
    {
      title: 'Draft the brand description',
      description:
        'Fetches the brand website and drafts an editable description, summary, and target market. Soft-fails; the budget is claimed before any external call. Requires expectedVersion.',
      inputSchema: z.object({
        expectedVersion: z.number().int().nonnegative(),
        regenerate: z.boolean().optional(),
        idempotencyKey: z.string().uuid().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      runSetupTool(
        env,
        executionContext,
        'draft_description',
        write,
        async (principal) =>
          unwrapState(await draftDescription(contextFor(env, principal), args)),
      ),
  );

  server.registerTool(
    'suggest_competitors',
    {
      title: 'Suggest competitors',
      description:
        'Generates editable competitor candidates from indexed company search. Suggestions replace the draft. Requires expectedVersion.',
      inputSchema: z.object({
        expectedVersion: z.number().int().nonnegative(),
        regenerate: z.boolean().optional(),
        idempotencyKey: z.string().uuid().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      runSetupTool(
        env,
        executionContext,
        'suggest_competitors',
        write,
        async (principal) =>
          unwrapState(
            await suggestCompetitors(contextFor(env, principal), args),
          ),
      ),
  );

  server.registerTool(
    'suggest_prompts',
    {
      title: 'Suggest monitoring prompts',
      description:
        'Generates categorized, editable monitoring prompt candidates. Suggestions replace the draft. Requires expectedVersion.',
      inputSchema: z.object({
        expectedVersion: z.number().int().nonnegative(),
        regenerate: z.boolean().optional(),
        idempotencyKey: z.string().uuid().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      runSetupTool(
        env,
        executionContext,
        'suggest_prompts',
        write,
        async (principal) =>
          unwrapState(await suggestPrompts(contextFor(env, principal), args)),
      ),
  );

  server.registerTool(
    'update_setup',
    {
      title: 'Update the setup draft',
      description:
        'Applies explicit edits to any draft field: step, description, summary, target market, logo, competitors, and prompts. Stale expectedVersion returns a structured conflict with the current state.',
      inputSchema: patchRequestSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runSetupTool(
        env,
        executionContext,
        'update_setup',
        write,
        async (principal) =>
          unwrapState(await updateDraft(contextFor(env, principal), args)),
      ),
  );

  server.registerTool(
    'preview_setup',
    {
      title: 'Preview the final setup',
      description:
        'Returns the exact canonical configuration, its draft version and SHA-256 hash, the expected prompt-surface checks, and warnings. Present this preview to the user before calling confirm_setup.',
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      runSetupTool(
        env,
        executionContext,
        'preview_setup',
        write,
        async (principal) => previewSetup(contextFor(env, principal)),
      ),
  );

  server.registerTool(
    'confirm_setup',
    {
      title: 'Confirm the approved setup',
      description:
        'Commits the approved preview: verifies expectedVersion and the canonical configuration hash, claims the one free report, and starts the onboarding run group. Present the preview_setup result to the user and get explicit approval before calling this tool; it starts provider-backed collection.',
      inputSchema: z.object({
        expectedVersion: z.number().int().nonnegative(),
        configurationHash: z.string().regex(/^[0-9a-f]{64}$/),
        idempotencyKey: z.string().uuid(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runSetupTool(
        env,
        executionContext,
        'confirm_setup',
        write,
        async (principal) => confirmSetup(contextFor(env, principal), args),
      ),
  );

  server.registerTool(
    'get_setup_report',
    {
      title: 'Get the pinned setup report',
      description:
        'Returns live progress, totals, run status, and report data for the setup run group. Poll with retryAfterSeconds instead of holding the call open.',
      inputSchema: z.object({
        setupId: z.number().int().positive().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runSetupTool(
        env,
        executionContext,
        'get_setup_report',
        inspect,
        async (principal) => {
          const report = await getSetupReport(
            getDb(env),
            env,
            principal.workspaceId,
            args.setupId,
          );
          if (!report) {
            return errorResult({
              error: {
                code: 'not_found',
                message: 'No setup commit for this workspace.',
              },
            });
          }
          return report;
        },
      ),
  );
};

// Read analytics still demand data:read even when a write-only grant exists.
export const requiresReadScope = (principal: McpPrincipal): void => {
  if (!principal.scopes.includes(MCP_SCOPE)) {
    throw new McpAccessError('data:read scope required');
  }
};
