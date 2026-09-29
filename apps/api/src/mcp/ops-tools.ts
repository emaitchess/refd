import type { McpServer } from '@modelcontextprotocol/server';
import { promptLimitMessage, surfaceLimitMessage } from '@refd/core/config';
import { funnelStageSchema, questionTypeSchema } from '@refd/core/prompt-axes';
import { PROMPT_KINDS, promptKindSchema } from '@refd/core/prompt-cohorts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isOperatorEmail } from '../auth/operator';
import { getDb } from '../db/client';
import { prompts, workspaces } from '../db/schema';
import type { AppEnv } from '../env';
import { createManualRun, previewManualRun } from '../ingest/runs';
import { attributeLabel, resolveAttributeId } from '../lib/attributes';
import {
  createEntity,
  type EntityRow,
  removeEntity,
} from '../lib/entity-store';
import { PROMPT_CATEGORIES } from '../lib/llm';
import {
  classifyWorkspacePrompts,
  promptKindOrDiscovery,
} from '../lib/prompt-cohorts';
import {
  createPrompt,
  type PromptRow,
  promptUsageCounts,
  removePrompt,
  setPromptActive,
  updatePromptFields,
} from '../lib/prompt-store';
import { domainField, multiLineText, singleLineText } from '../lib/sanitize';
import { configForUser } from '../lib/user-config';
import { aliasSchema, categorySchema } from '../onboarding/contracts';
import { enabledSurfaces, SURFACES, type Surface } from '../providers/types';
import { listEntities } from '../routes/metrics';
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

const promptPayload = (
  row: PromptRow,
  attributeLabel: string | null = null,
) => ({
  id: row.id,
  text: row.text,
  category: row.tags[0] ?? null,
  tags: row.tags,
  kind: promptKindOrDiscovery(row.kind),
  attributeId: row.attributeId,
  attribute: attributeLabel,
  // Null here means undeclared, which the intent rollup reports as its own
  // bucket rather than folding into a default.
  funnelStage: row.funnelStage,
  questionType: row.questionType,
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
  const db = getDb(env);
  // Listing is the natural place to resolve cohorts, since it is where a caller
  // learns which prompts exist; a filter used elsewhere must not silently miss
  // an unclassified prompt. Classify before reading so the payload and the
  // counts both see resolved kinds.
  await classifyWorkspacePrompts(db, workspace.id);
  const rows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.workspaceId, workspace.id))
    .orderBy(prompts.id);
  const usage = await promptUsageCounts(env, workspace.id);
  const truncated = rows.length > MAX_LISTED_PROMPTS;
  const kindCounts = PROMPT_KINDS.map((kind) => ({
    kind,
    prompts: rows.filter((row) => promptKindOrDiscovery(row.kind) === kind)
      .length,
  }));
  return {
    ok: true as const,
    limit: promptLimitFor(env, principal),
    activePrompts: rows.filter((row) => row.active).length,
    totalPrompts: rows.length,
    ...(truncated
      ? { truncated: true, listedPrompts: MAX_LISTED_PROMPTS }
      : {}),
    categories: [...PROMPT_CATEGORIES],
    kinds: [...PROMPT_KINDS],
    kindCounts,
    prompts: rows.slice(0, MAX_LISTED_PROMPTS).map((row) => ({
      ...promptPayload(row),
      answers: usage.get(row.id) ?? 0,
    })),
  };
};

export const addPromptBodySchema = z.object({
  text: multiLineText(8, 500),
  category: categorySchema.optional(),
  kind: promptKindSchema.optional(),
  // The capability this prompt tests, by label; it is created on first use. Omit
  // to leave the prompt ungrouped, which is a state the rollup reports rather
  // than hides.
  attribute: attributeLabel.optional(),
  // Declared intent axes. Neither is inferred from the text: no substring
  // settles where a buyer is in a journey, and a guessed value stored here is
  // indistinguishable from one a person chose. Omit to leave the prompt
  // undeclared, which the rollup counts rather than assuming.
  funnelStage: funnelStageSchema.optional(),
  questionType: questionTypeSchema.optional(),
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
    body.kind,
    body.attribute,
    { funnelStage: body.funnelStage, questionType: body.questionType },
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
    kind: promptKindSchema.optional(),
    // Explicit null detaches the prompt from its attribute; omitted leaves the
    // grouping alone.
    attribute: attributeLabel.nullish(),
    // Explicit null clears the declaration; omitted leaves it alone. Same
    // distinction as the attribute field above.
    funnelStage: funnelStageSchema.nullish(),
    questionType: questionTypeSchema.nullish(),
  })
  .refine(
    (body) =>
      body.text !== undefined ||
      body.category !== undefined ||
      body.kind !== undefined ||
      body.attribute !== undefined ||
      body.funnelStage !== undefined ||
      body.questionType !== undefined,
    'Provide text, category, kind, attribute, funnelStage, or questionType to update.',
  );

export const updatePrompt = async (
  env: AppEnv,
  _principal: McpPrincipal,
  workspace: McpWorkspace,
  body: z.infer<typeof updatePromptBodySchema>,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const db = getDb(env);
  const attributeId = await resolveAttributeId(
    db,
    workspace.id,
    body.attribute,
  );
  const result = await updatePromptFields(env, body.promptId, workspace.id, {
    ...(body.text !== undefined ? { text: body.text } : {}),
    ...(body.category !== undefined ? { tags: [body.category] } : {}),
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(attributeId !== undefined ? { attributeId } : {}),
    // nullish so an explicit null clears the declaration, which is different
    // from omitting the field and leaving the prompt as it was.
    ...(body.funnelStage !== undefined
      ? { funnelStage: body.funnelStage }
      : {}),
    ...(body.questionType !== undefined
      ? { questionType: body.questionType }
      : {}),
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
export const previewRunBodySchema = runOptionsBodySchema;

export const previewRun = async (
  env: AppEnv,
  principal: McpPrincipal,
  workspace: McpWorkspace,
  body: z.infer<typeof previewRunBodySchema>,
) => {
  // The same ADMIN_EMAILS boundary run_now has: a preview discloses the exact
  // provider spend a run would make, which is the operator's own information and
  // nobody else's. The 5/hour budget is reported, not enforced, so previewing a
  // sixth run still answers.
  if (!isOperatorEmail(principal.userEmail, env.ADMIN_EMAILS)) {
    throw new McpAccessError(
      'run_now_preview describes paid provider spend and is limited to administrator accounts (ADMIN_EMAILS).',
    );
  }
  await ensureOperationalWorkspace(env, workspace);
  const preview = await previewManualRun(getDb(env), env, workspace.id, {
    promptIds: body.promptIds,
    samples: body.samples,
  });
  if (!preview.ok) {
    return promptFailure(
      'no_workspace',
      'This workspace no longer exists.',
      404,
    );
  }
  const { ok: _ok, ...rest } = preview;
  return { ok: true as const, ...rest };
};

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

// Competitor CRUD and surface selection complete the operational picture:
// like the prompt tools, they write the live configuration after onboarding
// instead of editing the dead setup draft.

const entityPayload = (row: EntityRow) => ({
  id: row.id,
  name: row.name,
  domains: row.domains,
  aliases: row.aliases,
});

const addCompetitorBodySchema = z.object({
  name: singleLineText(1, 100),
  domains: z.array(domainField()).min(1).max(10),
  aliases: z.array(aliasSchema).max(8).default([]),
});

export const addCompetitor = async (
  env: AppEnv,
  _principal: McpPrincipal,
  workspace: McpWorkspace,
  body: z.infer<typeof addCompetitorBodySchema>,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const created = await createEntity(env, workspace.id, {
    name: body.name,
    domains: body.domains,
    aliases: body.aliases,
    isBrand: false,
  });
  if (!created.ok) {
    return promptFailure(
      'duplicate_name',
      'An entity with this name already exists in this workspace (the brand included); names are unique.',
      409,
    );
  }
  return { ok: true as const, entity: entityPayload(created.entity) };
};

const removeCompetitorBodySchema = z.object({
  name: singleLineText(1, 100),
});

export const removeCompetitor = async (
  env: AppEnv,
  _principal: McpPrincipal,
  workspace: McpWorkspace,
  body: z.infer<typeof removeCompetitorBodySchema>,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const all = await listEntities(getDb(env), workspace.id);
  const match = all.find(
    (entity) => entity.name.toLowerCase() === body.name.toLowerCase(),
  );
  if (!match) {
    return notFound();
  }
  const removed = await removeEntity(env, workspace.id, match.id);
  if (!removed.ok) {
    if (removed.reason === 'is-brand') {
      return promptFailure(
        'is_brand',
        'The brand entity cannot be removed; use set_brand to change it.',
        409,
      );
    }
    if (removed.reason === 'has-history') {
      return promptFailure(
        'has_history',
        'This competitor has scored results; removal would destroy trend data, so it is refused (the dashboard refuses the same way).',
        409,
      );
    }
    return notFound();
  }
  return {
    ok: true as const,
    removed: match.name,
    note: 'The competitor had no scored results and is deleted. Historical results keep their frozen entity snapshot.',
  };
};

export const listCompetitors = async (
  env: AppEnv,
  _principal: McpPrincipal,
  workspace: McpWorkspace,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const all = await listEntities(getDb(env), workspace.id);
  return {
    ok: true as const,
    competitors: all
      .filter((entity) => !entity.isBrand)
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        domains: entity.domains,
        aliases: entity.aliases,
      })),
  };
};

const surfaceBodySchema = z.object({
  surface: z.enum(SURFACES),
});

// Surfaces are stored as an explicit array in canonical SURFACES order; null
// means the entitlement default, which these tools materialize on first edit
// exactly like the dashboard Settings page does.
export const setSurfaceEnabled = async (
  env: AppEnv,
  principal: McpPrincipal,
  workspace: McpWorkspace,
  surface: Surface,
  enabled: boolean,
) => {
  await ensureOperationalWorkspace(env, workspace);
  const max = configForUser(principal.userEmail, env.ADMIN_EMAILS).limits
    .maxEnabledSurfacesPerWorkspace;
  const row = (
    await getDb(env)
      .select({ surfaces: workspaces.surfaces })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id))
      .limit(1)
  )[0];
  if (!row) {
    throw new McpAccessError('workspace is not part of this connection');
  }
  const current = enabledSurfaces(row.surfaces, max);
  const next = enabled
    ? [...new Set([...current, surface])]
    : current.filter((s) => s !== surface);
  if (enabled && !current.includes(surface) && next.length > max) {
    return promptFailure('surface_limit', surfaceLimitMessage(max), 409);
  }
  if (next.length === 0) {
    return promptFailure(
      'last_surface',
      'At least one surface must stay enabled; runs would have nothing to collect.',
      409,
    );
  }
  const ordered = SURFACES.filter((s) => next.includes(s));
  await getDb(env)
    .update(workspaces)
    .set({ surfaces: ordered })
    .where(eq(workspaces.id, workspace.id));
  return {
    ok: true as const,
    surfaces: ordered,
    changed: surface,
    note: 'Applies to the next run; each additional surface multiplies provider records per run.',
  };
};

export const registerOpsTools = (
  server: McpServer,
  env: AppEnv,
  executionContext: ExecutionContext,
): void => {
  server.registerTool(
    'list_prompts',
    {
      title: 'List tracked prompts',
      description:
        'Returns every tracked prompt in an onboarded workspace with id, text, category, tags, cohort kind, active status, and answer counts, plus the active-prompt limit, the valid categories, and the per-cohort prompt counts. Cohorts: brand_defining names your brand, alternative names only a tracked competitor, discovery names neither, and problem and market_perception are declared rather than derived; filter the analytics tools with kind to read one cohort. Use it before add/update/toggle/remove to resolve prompt ids.',
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
        "Adds one tracked prompt to an onboarded workspace and returns the assigned id. text is 8-500 chars; the optional category is one of Discovery, Evaluation, Comparison, Decision, Authority and becomes the prompt's single tag. The optional kind is one of brand_defining, alternative, discovery, problem, market_perception; omitted, it is classified from the text against the tracked brand and competitors and the resolved value comes back in the response. A same-text prompt resolves to the existing row (duplicated: true) instead of erroring. Refuses with prompt_limit when the workspace's active-prompt ceiling is full.",
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
        'Edits one prompt in an onboarded workspace: reword text, set category (the tags become just that category), and/or set the cohort kind (brand_defining, alternative, discovery, problem, market_perception) that analytics filters read; problem and market_perception are declared, since the text cannot settle them. Text is unique per workspace. Row-scoped on purpose: no setup draft version involved, and in-flight runs keep their frozen prompt set, so edits land on the next run.',
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
    'run_now_preview',
    {
      title: 'Preview a collection run',
      description:
        'Reports what run_now would spend on the same arguments, without spending it: the prompt count, surfaces, samples, the provider records the run would buy, the queue messages it would enqueue, any requested prompt ids that are inactive or unknown, and how many of the 5 hourly manual runs remain. A plan, not a reservation: a real run a moment later can still be rate limited. Administrator accounts only (ADMIN_EMAILS), because it discloses the exact paid spend. Use it to check a prompt subset or sample override before committing to one.',
      inputSchema: previewRunBodySchema.extend(workspaceSelectorSchema.shape),
      // Reads rather than writes, but gated by the same operator boundary as the
      // run it previews, and marked non-idempotent so a client does not cache a
      // spend figure that goes stale as the prompt set changes.
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, previewRunBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'run_now_preview',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(
            await previewRun(env, principal, workspace, parsed.body),
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

  server.registerTool(
    'add_competitor',
    {
      title: 'Add a competitor',
      description:
        'Adds one tracked competitor to an onboarded workspace: name (unique per workspace), 1-10 verified domains (run check_domain first; a wrong domain silently breaks citation matching forever), and up to 8 optional aliases. Returns the assigned id.',
      inputSchema: addCompetitorBodySchema.extend(
        workspaceSelectorSchema.shape,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, addCompetitorBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'add_competitor',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(
            await addCompetitor(env, principal, workspace, parsed.body),
          ),
      );
    },
  );

  server.registerTool(
    'remove_competitor',
    {
      title: 'Remove a competitor',
      description:
        'Removes one tracked competitor by name (names are unique per workspace). A competitor with scored results is refused: removal would destroy trend data. The brand entity is not a competitor; use set_brand to change it.',
      inputSchema: removeCompetitorBodySchema.extend(
        workspaceSelectorSchema.shape,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = selectorArgs(args, removeCompetitorBodySchema);
      if (!parsed) {
        return invalidSetupArgs();
      }
      return runSetupTool(
        env,
        executionContext,
        'remove_competitor',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(
            await removeCompetitor(env, principal, workspace, parsed.body),
          ),
      );
    },
  );

  server.registerTool(
    'list_competitors',
    {
      title: 'List tracked competitors',
      description:
        'Returns the tracked competitors of an onboarded workspace with id, name, domains, and aliases. Use it before remove_competitor; get_workspace_info shows the brand separately.',
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
        'list_competitors',
        {
          ...MUTATIONS,
          workspaceArg: parsed.workspaceArg,
          errorKind: PROMPT_ERROR_KIND,
        },
        async (principal, workspace) =>
          unwrapPrompt(await listCompetitors(env, principal, workspace)),
      );
    },
  );

  const surfaceTool = (
    name: string,
    title: string,
    description: string,
    enabled: boolean,
  ) => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: surfaceBodySchema.extend(workspaceSelectorSchema.shape),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        const parsed = selectorArgs(args, surfaceBodySchema);
        if (!parsed) {
          return invalidSetupArgs();
        }
        return runSetupTool(
          env,
          executionContext,
          name,
          {
            ...MUTATIONS,
            workspaceArg: parsed.workspaceArg,
            errorKind: PROMPT_ERROR_KIND,
          },
          async (principal, workspace) =>
            unwrapPrompt(
              await setSurfaceEnabled(
                env,
                principal,
                workspace,
                parsed.body.surface,
                enabled,
              ),
            ),
        );
      },
    );
  };

  surfaceTool(
    'enable_surface',
    'Enable an AI surface',
    "Enables one AI surface (chatgpt, perplexity, gemini, google_ai_mode, google_aio) on an onboarded workspace, effective from the next run. Refused at the caller's surface ceiling (standard users: 3; administrators: all 5). Every additional surface multiplies the provider records a run buys.",
    true,
  );

  surfaceTool(
    'disable_surface',
    'Disable an AI surface',
    'Disables one AI surface on an onboarded workspace, effective from the next run. At least one surface must stay enabled. Disabling stops collection cost immediately; historical data is untouched.',
    false,
  );
};
