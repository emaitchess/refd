import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getDb } from '../db/client';
import type { AppEnv } from '../env';
import { singleLineText } from '../lib/sanitize';
import { provisionWorkspace } from '../lib/workspace-provision';
import { MCP_SCOPE, MCP_WRITE_SCOPE } from '../oauth/constants';
import {
  brandRequestSchema,
  type OnboardingFailure,
  type OnboardingState,
  patchRequestSchema,
} from '../onboarding/contracts';
import { getSetupReport } from '../onboarding/report';
import {
  completeOnboarding,
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
  type McpWorkspace,
  resolveGrantedWorkspace,
  resolveMcpPrincipal,
} from './context';

// Optional workspace selector: validated against the connection's granted
// set at request time, never trusted from the argument itself. The grant
// stays the only entitlement; the selector only picks among what it holds.
export const workspaceArgSchema = z.number().int().positive().optional();

export const workspaceSelectorSchema = z.object({
  workspace: workspaceArgSchema,
});

const emptyBodySchema = z.object({});

const createWorkspaceBodySchema = z.object({
  name: singleLineText(1, 60),
  idempotencyKey: z.string().uuid().optional(),
});

const generationBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  regenerate: z.boolean().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

const confirmBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  configurationHash: z.string().regex(/^[0-9a-f]{64}$/),
  idempotencyKey: z.string().uuid(),
});

const reportBodySchema = z.object({
  setupId: z.number().int().positive().optional(),
});

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

const errorResult = (body: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
  isError: true,
});

const invalidSetupArgs = () =>
  errorResult({
    error: {
      code: 'invalid_arguments',
      message: 'The tool arguments did not match the published schema.',
    },
  });

// A provisioned workspace must be targetable by the very next call, so only
// grants that resolve workspaces created after approval may provision one:
// checked sets and PATs pin their entitlement at approval time.
export const createWorkspaceRefusal = (
  principal: Pick<McpPrincipal, 'allWorkspaces'>,
): string | null =>
  principal.allWorkspaces
    ? null
    : 'This connection was approved for a fixed set of workspaces, so a created workspace could not be targeted afterwards. Re-approve with Allow all workspaces, or check "Create a new workspace with this agent" at consent time.';

const failureResult = (failure: OnboardingFailure) =>
  errorResult({ error: failure.error, status: failure.status });

// Mutations target the workspace this call resolved from the grant.
const contextFor = (
  env: AppEnv,
  principal: McpPrincipal,
  workspace: McpWorkspace,
): OnboardingContext => ({
  db: getDb(env),
  env,
  workspaceId: workspace.id,
  workspaceName: workspace.name,
  userId: principal.userId,
  userEmail: principal.userEmail,
  adminEmails: env.ADMIN_EMAILS,
});

const runSetupTool = async (
  env: AppEnv,
  executionContext: ExecutionContext,
  name: string,
  options: { requireWrite: boolean; workspaceArg?: number },
  operation: (
    principal: McpPrincipal,
    workspace: McpWorkspace,
  ) => Promise<unknown>,
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
      return errorResult({
        error: {
          code: 'forbidden',
          message: 'This tool requires data:write on the connected workspace.',
        },
      });
    }
    const workspace = resolveGrantedWorkspace(principal, options.workspaceArg);
    const value = await operation(principal, workspace);
    console.log(
      JSON.stringify({
        event: 'mcp_tool_call',
        tool: name,
        clientId: principal.clientId,
        connectionId: principal.connectionRowId,
        userId: principal.userId,
        workspaceId: workspace.id,
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

// The published inputSchema is the body shape plus the workspace selector.
// Both schemas strip unknown keys, so parsing them separately over the same
// arguments accepts exactly the same inputs the merged schema would.
const selectorArgs = <T extends z.ZodObject<z.ZodRawShape>>(
  args: unknown,
  body: T,
): { workspaceArg: number | undefined; body: z.infer<T> } | null => {
  const parsedSelector = workspaceSelectorSchema.safeParse(args);
  const parsedBody = body.safeParse(args);
  if (!parsedSelector.success || !parsedBody.success) {
    return null;
  }
  return {
    workspaceArg: parsedSelector.data.workspace,
    body: parsedBody.data,
  };
};

// Registers the nine setup tools against a data:write grant. Only confirm_setup
// can trigger provider spend; generation tools claim the budget first; every
// mutation rides the same shared services as the dashboard.
export const registerSetupTools = (
  server: McpServer,
  env: AppEnv,
  executionContext: ExecutionContext,
): void => {
  server.registerTool(
    'get_setup_state',
    {
      title: 'Get onboarding setup state',
      description:
        'Returns the workspace setup wizard state: phase, editable draft, enabled surfaces, draft version, regeneration allowances, and commit state. With several approved workspaces, pass workspace to target one.',
      inputSchema: workspaceSelectorSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, emptyBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'get_setup_state',
        { requireWrite: false, workspaceArg: parsed.workspaceArg },
        async (principal, workspace) =>
          loadOnboardingState(contextFor(env, principal, workspace)),
      );
    },
  );

  server.registerTool(
    'set_brand',
    {
      title: 'Set the tracked brand',
      description:
        'Sets or updates the workspace brand: name, domains, and aliases. Requires expectedVersion from the latest setup state. With several approved workspaces, pass workspace to target one.',
      inputSchema: brandRequestSchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, brandRequestSchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'set_brand',
        { requireWrite: true, workspaceArg: parsed.workspaceArg },
        async (principal, workspace) =>
          unwrapState(
            await saveBrand(contextFor(env, principal, workspace), parsed.body),
          ),
      );
    },
  );

  const runGenerationTool = (
    name: string,
    title: string,
    description: string,
    idempotent: boolean,
    run: (
      ctx: OnboardingContext,
      body: z.infer<typeof generationBodySchema>,
    ) => Promise<unknown>,
  ) => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: generationBodySchema.extend(workspaceSelectorSchema.shape),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: idempotent,
          openWorldHint: true,
        },
      },
      async (args) => {
        const parsed = selectorArgs(args, generationBodySchema);
        if (!parsed) {
          return invalidSetupArgs();
        }
        return runSetupTool(
          env,
          executionContext,
          name,
          { requireWrite: true, workspaceArg: parsed.workspaceArg },
          async (principal, workspace) =>
            unwrapState(
              await run(contextFor(env, principal, workspace), parsed.body),
            ),
        );
      },
    );
  };

  const mutate = { requireWrite: true };

  runGenerationTool(
    'draft_description',
    'Draft the brand description',
    'Fetches the brand website and drafts an editable description, summary, and target market. Soft-fails; the budget is claimed before any external call. Requires expectedVersion. With several approved workspaces, pass workspace to target one.',
    false,
    draftDescription,
  );

  runGenerationTool(
    'suggest_competitors',
    'Suggest competitors',
    'Generates editable competitor candidates from indexed company search. Suggestions replace the draft. Requires expectedVersion. With several approved workspaces, pass workspace to target one.',
    false,
    suggestCompetitors,
  );

  runGenerationTool(
    'suggest_prompts',
    'Suggest monitoring prompts',
    'Generates categorized, editable monitoring prompt candidates. Suggestions replace the draft. Requires expectedVersion. With several approved workspaces, pass workspace to target one.',
    false,
    suggestPrompts,
  );

  server.registerTool(
    'update_setup',
    {
      title: 'Update the setup draft',
      description:
        'Applies explicit edits to any draft field: step, description, summary, target market, logo, competitors, prompts, and enabled surfaces. Stale expectedVersion returns a structured conflict with the current state. With several approved workspaces, pass workspace to target one.',
      inputSchema: patchRequestSchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, patchRequestSchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'update_setup',
        { ...mutate, workspaceArg: parsed.workspaceArg },
        async (principal, workspace) =>
          unwrapState(
            await updateDraft(
              contextFor(env, principal, workspace),
              parsed.body,
            ),
          ),
      );
    },
  );

  server.registerTool(
    'preview_setup',
    {
      title: 'Preview the final setup',
      description:
        'Returns the exact canonical configuration, its draft version and SHA-256 hash, the expected prompt-surface checks, and warnings. Present this preview to the user before calling confirm_setup. With several approved workspaces, pass workspace to target one.',
      inputSchema: workspaceSelectorSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, emptyBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'preview_setup',
        { ...mutate, workspaceArg: parsed.workspaceArg },
        async (principal, workspace) =>
          previewSetup(contextFor(env, principal, workspace)),
      );
    },
  );

  server.registerTool(
    'confirm_setup',
    {
      title: 'Confirm the approved setup',
      description:
        'Commits the approved preview: verifies expectedVersion and the canonical configuration hash, claims the one free report, and starts the onboarding run group. Present the preview_setup result to the user and get explicit approval before calling this tool; it starts provider-backed collection. With several approved workspaces, pass workspace to target one.',
      inputSchema: confirmBodySchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, confirmBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'confirm_setup',
        { ...mutate, workspaceArg: parsed.workspaceArg },
        async (principal, workspace) =>
          unwrapState(
            await confirmSetup(
              contextFor(env, principal, workspace),
              parsed.body,
            ),
          ),
      );
    },
  );

  server.registerTool(
    'get_setup_report',
    {
      title: 'Get the pinned setup report',
      description:
        'Returns live progress, totals, run status, and report data for the setup run group. Poll with retryAfterSeconds instead of holding the call open. With several approved workspaces, pass workspace to target one.',
      inputSchema: reportBodySchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, reportBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'get_setup_report',
        { requireWrite: false, workspaceArg: parsed.workspaceArg },
        async (_principal, workspace) => {
          const report = await getSetupReport(
            getDb(env),
            env,
            workspace.id,
            parsed.body.setupId,
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
      );
    },
  );

  server.registerTool(
    'complete_setup',
    {
      title: 'Finish onboarding',
      description:
        'Marks the workspace onboarded once its setup is committed (the report step is done). Idempotent and gated exactly like the dashboard "enter dashboard" button: the setup must be committed, but the report runs need not be complete. Review get_setup_report first. With several approved workspaces, pass workspace to target one.',
      inputSchema: emptyBodySchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, emptyBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'complete_setup',
        { ...mutate, workspaceArg: parsed.workspaceArg },
        async (principal, workspace) =>
          unwrapState(
            await completeOnboarding(contextFor(env, principal, workspace)),
          ),
      );
    },
  );

  // Provisioning targets no granted workspace, so this tool resolves the
  // principal directly instead of through runSetupTool's workspace selector.
  server.registerTool(
    'create_workspace',
    {
      title: 'Create a workspace',
      description:
        "Provisions a new workspace owned by the connection's user, naming it; the optional idempotencyKey makes duplicate calls resolve to one workspace. Only connections approved with Allow all workspaces may call it, because a created workspace must join the grant for the next call to target it. Nothing is collected until the setup tools onboard it.",
      inputSchema: createWorkspaceBodySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = createWorkspaceBodySchema.safeParse(args);
      if (!parsed.success) {
        return invalidSetupArgs();
      }
      const startedAt = Date.now();
      try {
        const principal = await resolveMcpPrincipal(env, executionContext);
        const logEvent = (
          outcome: 'ok' | 'denied' | 'error',
          error?: string,
          workspaceId?: number,
        ) =>
          console.log(
            JSON.stringify({
              event: 'mcp_tool_call',
              tool: 'create_workspace',
              clientId: principal.clientId,
              connectionId: principal.connectionRowId,
              userId: principal.userId,
              durationMs: Date.now() - startedAt,
              outcome,
              ...(workspaceId !== undefined ? { workspaceId } : {}),
              ...(error !== undefined ? { error } : {}),
            }),
          );
        if (!principal.scopes.includes(MCP_WRITE_SCOPE)) {
          logEvent('denied', 'missing data:write scope');
          return errorResult({
            error: {
              code: 'forbidden',
              message:
                'This tool requires data:write on the connected workspace.',
            },
          });
        }
        const refusal = createWorkspaceRefusal(principal);
        if (refusal !== null) {
          logEvent('denied', 'grant is not all-workspaces');
          return errorResult({
            error: { code: 'grant_not_all_workspaces', message: refusal },
          });
        }
        const created = await provisionWorkspace(
          env,
          { id: principal.userId, email: principal.userEmail },
          parsed.data.name,
          parsed.data.idempotencyKey ?? null,
        );
        if (!created.ok) {
          logEvent('error', 'limit_reached');
          return errorResult({
            error: { code: 'limit_reached', message: created.error },
          });
        }
        logEvent('ok', undefined, created.id);
        return textResult({
          ok: true,
          workspace: { id: created.id, name: created.name },
          next: 'Onboard it with get_setup_state, set_brand, and the rest of the setup tools; it already belongs to this connection.',
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'mcp_tool_call',
            tool: 'create_workspace',
            durationMs: Date.now() - startedAt,
            outcome: error instanceof McpAccessError ? 'denied' : 'error',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return errorResult({
          error: {
            code: error instanceof McpAccessError ? 'forbidden' : 'setup_error',
            message:
              error instanceof Error ? error.message : 'The setup tool failed.',
          },
        });
      }
    },
  );
};

// Read analytics still demand data:read even when a write-only grant exists.
export const requiresReadScope = (principal: McpPrincipal): void => {
  if (!principal.scopes.includes(MCP_SCOPE)) {
    throw new McpAccessError('data:read scope required');
  }
};
