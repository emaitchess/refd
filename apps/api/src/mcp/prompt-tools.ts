import type { McpServer } from '@modelcontextprotocol/server';
import { promptLimitMessage } from '@refd/core/config';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isOperatorEmail } from '../auth/operator';
import { getDb } from '../db/client';
import { prompts, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import { createManualRun } from '../ingest/runs';
import { PROMPT_CATEGORIES } from '../lib/llm';
import {
  createPrompt,
  type PromptRow,
  promptUsageCounts,
  removePrompt,
  setPromptActive,
  updatePromptFields,
} from '../lib/prompt-store';
import { multiLineText } from '../lib/sanitize';
import { configForUser } from '../lib/user-config';
import { categorySchema } from '../onboarding/contracts';
import { runOptionsBodySchema } from '../routes/runs';
import {
  McpAccessError,
  type McpPrincipal,
  type McpWorkspace,
} from './context';
import {
  errorResult,
  invalidSetupArgs,
  runSetupTool,
  selectorArgs,
  textResult,
  workspaceSelectorSchema,
} from './setup-tools';

// Prompt management is operational, not setup-shaped: onboarded workspaces
// change single prompts in place instead of rewriting the setup draft. These
// tools are row-scoped on purpose — no expectedVersion, no draft — because a
// prompt edit cannot clobber another writer the way a whole-list rewrite can.

const PROMPT_ERROR_KIND = {
  code: 'prompt_error',
  message: 'The prompt tool failed.',
};

type PromptFailure = {
  ok: false;
  error: { code: string; message: string };
  status?: number;
};

const promptFailure = (
  code: string,
  message: string,
  status?: number,
): PromptFailure => ({
  ok: false,
  error: { code, message },
  ...(status !== undefined ? { status } : {}),
});

const notFound = () =>
  promptFailure('not_found', 'No prompt with this id in this workspace.', 404);

export const unwrapPrompt = (value: unknown) =>
  value !== null &&
  typeof value === 'object' &&
  (value as { ok?: boolean }).ok === false
    ? errorResult(value)
    : textResult(value);

const promptPayload = (row: PromptRow) => ({
  id: row.id,
  text: row.text,
  category: row.tags[0] ?? null,
  tags: row.tags,
  active: row.active,
});

// Mutations (and reads, for a coherent list of ids to mutate) belong to the
// data:write surface; the nine analytics tools already serve read grants via
// get_prompt_performance.
const MUTATIONS = { requireWrite: true };

// The setup draft owns a workspace's prompts until onboarding settles: rows
// materialize at commit, so pre-commit CRUD would fight the wizard.
export const ensureOperationalWorkspace = async (
  env: AppEnv,
  workspace: McpWorkspace,
): Promise<void> => {
  const row = (
    await getDb(env)
      .select({
        onboardingCompleted: workspaces.onboardingCompleted,
        profile: workspaces.profile,
      })
      .from(workspaces)
      .where(
        and(eq(workspaces.id, workspace.id), isNull(workspaces.deletingAt)),
      )
      .limit(1)
  )[0];
  if (!row) {
    throw new McpAccessError('workspace is not part of this connection');
  }
  if (!(row.onboardingCompleted || row.profile?.committed === true)) {
    throw new McpAccessError(
      'This workspace has not finished onboarding: its prompts are still the setup draft. Finish onboarding (confirm_setup, then complete_setup), or edit the draft with update_setup.',
    );
  }
};

const promptLimitFor = (env: AppEnv, principal: McpPrincipal) =>
  configForUser(principal.userEmail, env.ADMIN_EMAILS).limits
    .maxActivePromptsPerWorkspace;

const MAX_LISTED_PROMPTS = 500;

export const listPrompts = async (
  env: AppEnv,
  principal: McpPrincipal,
  workspace: McpWorkspace,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const rows = await getDb(env)
    .select()
    .from(prompts)
    .where(eq(prompts.workspaceId, workspace.id))
    .orderBy(prompts.id);
  const usage = await promptUsageCounts(env, workspace.id);
  const truncated = rows.length > MAX_LISTED_PROMPTS;
  return {
    ok: true as const,
    limit: promptLimitFor(env, principal),
    activePrompts: rows.filter((row) => row.active).length,
    totalPrompts: rows.length,
    ...(truncated
      ? { truncated: true, listedPrompts: MAX_LISTED_PROMPTS }
      : {}),
    categories: [...PROMPT_CATEGORIES],
    prompts: rows.slice(0, MAX_LISTED_PROMPTS).map((row) => ({
      ...promptPayload(row),
      answers: usage.get(row.id) ?? 0,
    })),
  };
};

export const addPromptBodySchema = z.object({
  text: multiLineText(8, 500),
  category: categorySchema.optional(),
});

export const addPrompt = async (
  env: AppEnv,
  principal: McpPrincipal,
  workspace: McpWorkspace,
  body: z.infer<typeof addPromptBodySchema>,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const created = await createPrompt(
    env,
    workspace.id,
    body.text,
    body.category ? [body.category] : [],
    promptLimitFor(env, principal),
  );
  if (!created.ok) {
    return promptFailure(
      'prompt_limit',
      promptLimitMessage(created.limit),
      409,
    );
  }
  return {
    ok: true as const,
    duplicated: created.duplicated,
    ...(created.duplicated
      ? {
          note: 'A prompt with this text already existed; returning it unchanged.',
        }
      : {}),
    prompt: promptPayload(created.prompt),
  };
};

export const updatePromptBodySchema = z
  .object({
    promptId: z.number().int().positive(),
    text: multiLineText(8, 500).optional(),
    category: categorySchema.optional(),
  })
  .refine(
    (body) => body.text !== undefined || body.category !== undefined,
    'Provide text or category to update.',
  );

export const updatePrompt = async (
  env: AppEnv,
  _principal: McpPrincipal,
  workspace: McpWorkspace,
  body: z.infer<typeof updatePromptBodySchema>,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const result = await updatePromptFields(env, body.promptId, workspace.id, {
    ...(body.text !== undefined ? { text: body.text } : {}),
    ...(body.category !== undefined ? { tags: [body.category] } : {}),
  });
  if (!result.ok) {
    return result.reason === 'duplicate'
      ? promptFailure(
          'duplicate_prompt',
          'Another prompt in this workspace already uses this text; prompt text is unique per workspace.',
          409,
        )
      : notFound();
  }
  return { ok: true as const, prompt: promptPayload(result.prompt) };
};

export const togglePromptBodySchema = z.object({
  promptId: z.number().int().positive(),
  active: z.boolean(),
});

export const togglePrompt = async (
  env: AppEnv,
  principal: McpPrincipal,
  workspace: McpWorkspace,
  body: z.infer<typeof togglePromptBodySchema>,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const result = await setPromptActive(
    env,
    body.promptId,
    workspace.id,
    body.active,
    promptLimitFor(env, principal),
  );
  if (!result.ok) {
    if (result.reason === 'limit') {
      return promptFailure(
        'prompt_limit',
        promptLimitMessage(result.limit),
        409,
      );
    }
    if (result.reason === 'duplicate') {
      return promptFailure(
        'duplicate_prompt',
        'Another prompt in this workspace already uses this text; prompt text is unique per workspace.',
        409,
      );
    }
    return notFound();
  }
  return { ok: true as const, prompt: promptPayload(result.prompt) };
};

export const removePromptBodySchema = z.object({
  promptId: z.number().int().positive(),
});

export const removePromptTool = async (
  env: AppEnv,
  _principal: McpPrincipal,
  workspace: McpWorkspace,
  body: z.infer<typeof removePromptBodySchema>,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const result = await removePrompt(env, body.promptId, workspace.id, {
    retireWhenUsed: true,
  });
  if (!result.ok) {
    return notFound();
  }
  if (result.action === 'deleted') {
    return {
      ok: true as const,
      action: 'deleted' as const,
      id: result.id,
      note: 'The prompt had no results and is deleted.',
    };
  }
  return {
    ok: true as const,
    action: 'retired' as const,
    prompt: promptPayload(result.prompt),
    note: 'Results reference this prompt, so it was retired (active=false): history is preserved, future runs skip it, and toggle_prompt can re-activate it.',
  };
};

export const runNowBodySchema = runOptionsBodySchema;

export const runNow = async (
  env: AppEnv,
  principal: McpPrincipal,
  workspace: McpWorkspace,
  body: z.infer<typeof runNowBodySchema>,
) => {
  // The one paid-spend trigger outside the setup report: the same
  // ADMIN_EMAILS boundary and 5/hour guard as the operator HTTP route.
  // Thrown, not returned, so the call logs as denied like a scope refusal.
  if (!isOperatorEmail(principal.userEmail, env.ADMIN_EMAILS)) {
    throw new McpAccessError(
      'run_now spends provider quota and is limited to administrator accounts (ADMIN_EMAILS).',
    );
  }
  await ensureOperationalWorkspace(env, workspace);
  const active = (
    await getDb(env)
      .select({ count: sql<number>`count(*)` })
      .from(prompts)
      .where(
        and(eq(prompts.workspaceId, workspace.id), eq(prompts.active, true)),
      )
  )[0];
  if (Number(active?.count ?? 0) === 0) {
    return promptFailure(
      'no_active_prompts',
      'This workspace has no active prompts to run; add one with add_prompt first.',
      409,
    );
  }
  const started = await createManualRun(getDb(env), env, workspace.id, {
    promptIds: body.promptIds,
    samples: body.samples,
  });
  if (!started.ok) {
    return promptFailure(
      'manual_run_limit',
      'Manual run limit reached (5 per hour for this workspace).',
      429,
    );
  }
  return {
    ok: true as const,
    run: {
      id: started.run.runId,
      date: started.date,
      created: started.run.created,
      totalCount: started.run.totalCount,
      dispatchState: started.run.dispatchState,
      dispatchAttempts: started.run.dispatchAttempts,
    },
    note: 'Collection fans out through the ingest queue and takes minutes; the run froze the current prompt and entity sets. Poll get_prompt_performance with range 1d afterwards.',
  };
};

export const registerPromptTools = (
  server: McpServer,
  env: AppEnv,
  executionContext: ExecutionContext,
): void => {
  server.registerTool(
    'list_prompts',
    {
      title: 'List tracked prompts',
      description:
        'Returns every tracked prompt in an onboarded workspace with id, text, category, tags, active status, and answer counts, plus the active-prompt limit and the valid categories. Use it before add/update/toggle/remove to resolve prompt ids.',
      inputSchema: z.object({}).extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, z.object({}));
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'list_prompts',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(await listPrompts(env, principal, workspace)),
      );
    },
  );

  server.registerTool(
    'add_prompt',
    {
      title: 'Add a tracked prompt',
      description:
        "Adds one tracked prompt to an onboarded workspace and returns the assigned id. text is 8-500 chars; the optional category is one of Discovery, Evaluation, Comparison, Decision, Authority and becomes the prompt's single tag. A same-text prompt resolves to the existing row (duplicated: true) instead of erroring. Refuses with prompt_limit when the workspace's active-prompt ceiling is full.",
      inputSchema: addPromptBodySchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, addPromptBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'add_prompt',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(await addPrompt(env, principal, workspace, parsed.body)),
      );
    },
  );

  server.registerTool(
    'update_prompt',
    {
      title: 'Update a tracked prompt',
      description:
        'Edits one prompt in an onboarded workspace: reword text and/or set category (the tags become just that category). Text is unique per workspace. Row-scoped on purpose: no setup draft version involved, and in-flight runs keep their frozen prompt set, so edits land on the next run.',
      inputSchema: updatePromptBodySchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, updatePromptBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'update_prompt',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(
            await updatePrompt(env, principal, workspace, parsed.body),
          ),
      );
    },
  );

  server.registerTool(
    'toggle_prompt',
    {
      title: 'Toggle a tracked prompt',
      description:
        'Enables or disables one prompt without deleting it: active=false preserves history and stops future runs from selecting it. Re-activating is refused with prompt_limit when the workspace is already at its active-prompt ceiling.',
      inputSchema: togglePromptBodySchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, togglePromptBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'toggle_prompt',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(
            await togglePrompt(env, principal, workspace, parsed.body),
          ),
      );
    },
  );

  server.registerTool(
    'remove_prompt',
    {
      title: 'Remove a tracked prompt',
      description:
        'Removes one prompt: with stored results it is retired (active=false, history preserved, re-activatable with toggle_prompt); with no results it is deleted outright. The only destructive prompt tool.',
      inputSchema: removePromptBodySchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, removePromptBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'remove_prompt',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(
            await removePromptTool(env, principal, workspace, parsed.body),
          ),
      );
    },
  );

  server.registerTool(
    'run_now',
    {
      title: 'Run collection now',
      description:
        'Triggers an immediate collection run over the current active prompt set on every enabled surface. Spends paid provider quota and is limited to administrator accounts (ADMIN_EMAILS); at most 5 manual runs per hour per workspace. Use after prompt changes or publishing new content when the next scheduled run is too far away. Optional promptIds select a subset of the active prompts; optional samples (1-10) overrides the default sample count.',
      inputSchema: runNowBodySchema.extend(workspaceSelectorSchema.shape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, runNowBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'run_now',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(await runNow(env, principal, workspace, parsed.body)),
      );
    },
  );
};
