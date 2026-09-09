import { promptLimitMessage } from '@refd/core/config';
import { siteMetadataSchema } from '@refd/core/site-metadata';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  entities,
  prompts,
  setupCommits,
  setupUsage,
  type WorkspaceProfile,
  workspaces,
} from '../db/schema';
import type { AppEnv } from '../env';
import { createRun } from '../ingest/runs';
import { discoverCompetitors } from '../lib/exa';
import { describeBrand, generatePrompts, PROMPT_CATEGORIES } from '../lib/llm';
import { insertActivePrompt } from '../lib/prompt-limit';
import { domainField, multiLineText, singleLineText } from '../lib/sanitize';
import { fetchSiteMetadata, fetchSiteText } from '../lib/site-fetch';
import { configForUser } from '../lib/user-config';
import { enabledSurfaces } from '../providers/types';
import {
  claimFreeReport,
  claimGenerationAttempt,
  type GenerationSection,
  releaseReportClaim,
  settleGenerationAttempt,
} from './budget';
import {
  CONFIGURATION_SCHEMA_VERSION,
  canonicalConfigurationHash,
  canonicalizeSetupConfiguration,
  type SetupConfiguration,
} from './canonical';
import {
  type BrandInput,
  type OnboardingFailure,
  type OnboardingState,
  REGEN_LIMIT,
  type UpdateDraftInput,
} from './contracts';

export interface OnboardingContext {
  db: Db;
  env: AppEnv;
  workspaceId: number;
  workspaceName: string;
  userId: number;
  userEmail: string;
  adminEmails: string | undefined;
}

const config = (ctx: OnboardingContext) =>
  configForUser(ctx.userEmail, ctx.adminEmails);

const getProfile = async (db: Db, wsId: number): Promise<WorkspaceProfile> => {
  const ws = (
    await db.select().from(workspaces).where(eq(workspaces.id, wsId))
  )[0];
  return (ws?.profile ?? {}) as WorkspaceProfile;
};

// Persist a partial draft, merged over the existing profile JSON.
const mergeProfile = async (
  db: Db,
  wsId: number,
  patch: Partial<WorkspaceProfile>,
): Promise<void> => {
  const current = await getProfile(db, wsId);
  await db
    .update(workspaces)
    .set({ profile: { ...current, ...patch } })
    .where(eq(workspaces.id, wsId));
};

type RegenKey = keyof NonNullable<WorkspaceProfile['regen']>;

const regenAllowed = (
  profile: WorkspaceProfile,
  key: RegenKey,
  regenerate: boolean | undefined,
): boolean => !regenerate || (profile.regen?.[key] ?? 0) < REGEN_LIMIT;

// Merged into the profile on the success path only — a draft that fails must not
// cost the user their one retry.
const bumpRegen = (
  profile: WorkspaceProfile,
  key: RegenKey,
  regenerate: boolean | undefined,
): Partial<WorkspaceProfile> =>
  regenerate
    ? { regen: { ...profile.regen, [key]: (profile.regen?.[key] ?? 0) + 1 } }
    : {};

const regenSpent: OnboardingFailure = {
  error: 'regenerate limit reached',
  status: 429,
};

type DraftCompetitor = NonNullable<WorkspaceProfile['competitors']>[number];

const draftIdFor = (draftId: string | undefined, index: number): string =>
  draftId ?? `legacy:${index}`;

const withDraftIds = <T extends { draftId?: string }>(
  drafts: T[],
): (T & { draftId: string })[] =>
  drafts.map((draft) => ({
    ...draft,
    draftId: draft.draftId ?? crypto.randomUUID(),
  }));

// The canonical competitor draft shape; upgrades legacy single-`domain` drafts
// so an in-flight wizard survives the shape change.
const normalizeCompetitor = (
  comp: {
    draftId?: string;
    name: string;
    domain?: string;
    domains?: string[];
    aliases?: { value: string; caseSensitive?: boolean }[];
  },
  index = 0,
): {
  draftId: string;
  name: string;
  domains: string[];
  aliases: { value: string; caseSensitive?: boolean }[];
} => ({
  draftId: draftIdFor(comp.draftId, index),
  name: comp.name,
  domains: comp.domains ?? (comp.domain ? [comp.domain] : []),
  aliases: comp.aliases ?? [],
});

const normalizePrompts = (
  prompts: { draftId?: string; text: string; category: string }[],
): { draftId: string; text: string; category: string }[] =>
  prompts.map((prompt, index) => ({
    draftId: draftIdFor(prompt.draftId, index),
    text: prompt.text,
    category: prompt.category,
  }));

const storedSiteMetadata = (value: unknown) => {
  const parsed = siteMetadataSchema.safeParse(value);
  return parsed.success && Object.values(parsed.data).some(Boolean)
    ? parsed.data
    : null;
};

// favicon.im/google favicons — deterministic, no auth. Used as the brand logo.
const faviconUrl = (domain: string): string =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

const brandFor = async (db: Db, wsId: number) =>
  (
    await db
      .select()
      .from(entities)
      .where(and(eq(entities.workspaceId, wsId), eq(entities.isBrand, true)))
  )[0];

export const loadOnboardingState = async (
  ctx: OnboardingContext,
): Promise<OnboardingState> => {
  const { db, workspaceId } = ctx;
  const ws = (
    await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  )[0];
  const brand = await brandFor(db, workspaceId);
  const profile = (ws?.profile ?? {}) as WorkspaceProfile;
  return {
    onboardingCompleted: ws?.onboardingCompleted ?? false,
    committed: profile.committed ?? false,
    step: profile.step ?? (brand ? 'describe' : 'brand'),
    version: ws?.onboardingDraftVersion ?? 0,
    surfaces: enabledSurfaces(
      ws?.surfaces ?? null,
      config(ctx).limits.maxEnabledSurfacesPerWorkspace,
    ),
    brand: brand
      ? {
          id: brand.id,
          name: brand.name,
          domains: brand.domains,
          aliases: brand.aliases,
        }
      : null,
    profile: {
      description: profile.description ?? '',
      summary: profile.summary ?? '',
      targetMarket: profile.targetMarket ?? '',
      logoUrl: profile.logoUrl ?? '',
      siteMetadata: storedSiteMetadata(profile.siteMetadata),
      competitors: (profile.competitors ?? []).map(normalizeCompetitor),
      prompts: normalizePrompts(profile.prompts ?? []),
    },
    regenLimit: REGEN_LIMIT,
    regen: {
      describe: profile.regen?.describe ?? 0,
      competitors: profile.regen?.competitors ?? 0,
      prompts: profile.regen?.prompts ?? 0,
    },
  };
};

const conflictFailure = async (
  ctx: OnboardingContext,
  currentVersion: number,
): Promise<OnboardingFailure> => ({
  error: {
    code: 'draft_version_conflict',
    message: 'The setup changed since it was read.',
    currentVersion,
    state: await loadOnboardingState(ctx),
  },
  status: 409,
});

const alreadyCommitted: OnboardingFailure = {
  error: 'setup is already committed for this workspace',
  status: 409,
};

const activeSetupCommit = async (db: Db, workspaceId: number) =>
  (
    await db
      .select()
      .from(setupCommits)
      .where(
        and(
          eq(setupCommits.workspaceId, workspaceId),
          eq(setupCommits.claimStatus, 'active'),
        ),
      )
  )[0];

const budgetFailure = (decision: {
  ok: false;
  retryAfterSeconds: number;
  limit: string;
}): OnboardingFailure => ({
  error: {
    code: 'setup_budget_exhausted',
    message: `setup budget exhausted (${decision.limit})`,
    retryAfterSeconds: decision.retryAfterSeconds,
  },
  status: 429,
});

const loadDraftForMutation = async (
  ctx: OnboardingContext,
  expectedVersion: number,
): Promise<
  { profile: WorkspaceProfile; version: number } | OnboardingFailure
> => {
  const { db, workspaceId } = ctx;
  if (await activeSetupCommit(db, workspaceId)) {
    return alreadyCommitted;
  }
  const ws = (
    await db
      .select({
        version: workspaces.onboardingDraftVersion,
        profile: workspaces.profile,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
  )[0];
  if (!ws) {
    return { error: 'workspace not found', status: 404 };
  }
  if (ws.version !== expectedVersion) {
    return conflictFailure(ctx, ws.version);
  }
  return {
    profile: (ws.profile ?? {}) as WorkspaceProfile,
    version: ws.version,
  };
};

// CAS draft mutation: the version guard makes dashboard and MCP edits collide
// loudly instead of silently overwriting one another. Legacy drafts gain
// stable draftIds on their next successful mutation.
const mutateDraft = async (
  ctx: OnboardingContext,
  expectedVersion: number,
  mutate: (profile: WorkspaceProfile) => Partial<WorkspaceProfile>,
): Promise<OnboardingState | OnboardingFailure> => {
  const loaded = await loadDraftForMutation(ctx, expectedVersion);
  if ('error' in loaded) {
    return loaded;
  }
  const patch = mutate(loaded.profile);
  const merged: WorkspaceProfile = {
    ...loaded.profile,
    ...patch,
    competitors: withDraftIds(
      (patch.competitors ?? loaded.profile.competitors ?? []).map((c, i) =>
        normalizeCompetitor(c, i),
      ),
    ),
    prompts: withDraftIds(
      normalizePrompts(patch.prompts ?? loaded.profile.prompts ?? []),
    ),
  };
  const { db, workspaceId } = ctx;
  const updated = await db
    .update(workspaces)
    .set({
      profile: merged,
      onboardingDraftVersion: expectedVersion + 1,
    })
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.onboardingDraftVersion, expectedVersion),
      ),
    )
    .returning({ id: workspaces.id });
  if (updated.length === 0) {
    const ws = (
      await db
        .select({ version: workspaces.onboardingDraftVersion })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
    )[0];
    return conflictFailure(ctx, ws?.version ?? expectedVersion);
  }
  return loadOnboardingState(ctx);
};

export const fetchSiteMetadataState = async (
  ctx: OnboardingContext,
): Promise<{ metadata: ReturnType<typeof storedSiteMetadata> }> => {
  const { db, env, workspaceId } = ctx;
  const profile = await getProfile(db, workspaceId);
  const cached = storedSiteMetadata(profile.siteMetadata);
  if (cached) {
    return { metadata: cached };
  }
  const brand = await brandFor(db, workspaceId);
  const domain = brand?.domains[0];
  const metadata = domain ? await fetchSiteMetadata(env, domain) : null;
  if (metadata) {
    await mergeProfile(db, workspaceId, { siteMetadata: metadata });
  }
  return { metadata };
};

// Step 1: create (or update) the brand entity so the later wizard steps have
// something to enrich. Idempotent — safe to resubmit on resume.
export const saveBrand = async (
  ctx: OnboardingContext,
  data: BrandInput,
): Promise<OnboardingState | OnboardingFailure> => {
  const { db, workspaceId } = ctx;
  const loaded = await loadDraftForMutation(ctx, data.expectedVersion);
  if ('error' in loaded) {
    return loaded;
  }
  const existing = await brandFor(db, workspaceId);
  // Resubmitting the step must not wipe caseSensitive flags set elsewhere:
  // carry the flag over for any alias value that survives the edit.
  const prevFlags = new Map(
    (existing?.aliases ?? []).map((a) => [
      a.value.toLowerCase(),
      a.caseSensitive === true,
    ]),
  );
  const aliases = data.aliases.map((value) => ({
    value,
    caseSensitive: prevFlags.get(value.toLowerCase()) ? true : undefined,
  }));
  if (existing) {
    await db
      .update(entities)
      .set({ name: data.name, domains: data.domains, aliases })
      .where(eq(entities.id, existing.id));
  } else {
    await db
      .insert(entities)
      .values({
        workspaceId,
        name: data.name,
        domains: data.domains,
        aliases,
        isBrand: true,
        sortOrder: 0,
      })
      .onConflictDoNothing({ target: [entities.workspaceId, entities.name] });
  }
  // Tidy the register-time default workspace name (email local part) to the brand.
  if (ctx.workspaceName === ctx.userEmail.split('@')[0]) {
    await db
      .update(workspaces)
      .set({ name: data.name })
      .where(eq(workspaces.id, workspaceId));
  }
  return mutateDraft(ctx, data.expectedVersion, () => ({
    step: 'describe',
    siteMetadata: undefined,
  }));
};

type GenerationOpts = {
  regenerate?: boolean;
  expectedVersion: number;
  idempotencyKey?: string;
};

const prepareGeneration = async (
  ctx: OnboardingContext,
  section: GenerationSection,
  opts: GenerationOpts,
): Promise<
  | { proceed: true; claimId: number; profile: WorkspaceProfile }
  | { proceed: false; failure: OnboardingFailure }
> => {
  const loaded = await loadDraftForMutation(ctx, opts.expectedVersion);
  if ('error' in loaded) {
    return { proceed: false, failure: loaded };
  }
  if (!regenAllowed(loaded.profile, section, opts.regenerate)) {
    return { proceed: false, failure: regenSpent };
  }
  const claim = await claimGenerationAttempt(ctx.db, ctx.env, {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    section,
    isAdmin: config(ctx).isAdmin,
    idempotencyKey: opts.idempotencyKey,
  });
  if (!claim.ok) {
    return { proceed: false, failure: budgetFailure(claim) };
  }
  return { proceed: true, claimId: claim.claimId, profile: loaded.profile };
};

// A version lost mid-generation means a concurrent edit landed while the model
// worked. The paid result is discarded (never silently merged) and the caller
// re-previews; the attempt still settles as spent.
const generationWriteConflict = async (
  ctx: OnboardingContext,
): Promise<OnboardingFailure> => {
  const ws = (
    await ctx.db
      .select({ version: workspaces.onboardingDraftVersion })
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId))
  )[0];
  return conflictFailure(ctx, ws?.version ?? 0);
};

const casWrite = async (
  ctx: OnboardingContext,
  expectedVersion: number,
  patch: Partial<WorkspaceProfile>,
): Promise<boolean> => {
  const { db, workspaceId } = ctx;
  const profile = await getProfile(db, workspaceId);
  const merged: WorkspaceProfile = {
    ...profile,
    ...patch,
    competitors: withDraftIds(
      (patch.competitors ?? profile.competitors ?? []).map((c, i) =>
        normalizeCompetitor(c, i),
      ),
    ),
    prompts: withDraftIds(
      normalizePrompts(patch.prompts ?? profile.prompts ?? []),
    ),
  };
  const updated = await db
    .update(workspaces)
    .set({ profile: merged, onboardingDraftVersion: expectedVersion + 1 })
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.onboardingDraftVersion, expectedVersion),
      ),
    )
    .returning({ id: workspaces.id });
  return updated.length > 0;
};

// Step 2 (AI): fetch the brand's site and draft an editable description. Every
// failure is soft (ok:false) so the client falls back to manual entry — the
// wizard must never dead-end on a flaky site or model call.
export const draftDescription = async (
  ctx: OnboardingContext,
  opts: GenerationOpts,
): Promise<
  | { ok: true; source: string; state: OnboardingState }
  | { ok: false; reason: 'fetch' | 'llm'; state: OnboardingState }
  | OnboardingFailure
> => {
  const prepared = await prepareGeneration(ctx, 'describe', opts);
  if (!prepared.proceed) {
    return prepared.failure;
  }
  const { db, env, workspaceId } = ctx;
  const brand = await brandFor(db, workspaceId);
  const domain = brand?.domains[0];
  if (!brand || !domain) {
    await settleGenerationAttempt(db, prepared.claimId, 'failed');
    return {
      ok: false,
      reason: 'fetch',
      state: await loadOnboardingState(ctx),
    };
  }
  const site = await fetchSiteText(env, domain);
  if (!site) {
    await settleGenerationAttempt(db, prepared.claimId, 'failed');
    return {
      ok: false,
      reason: 'fetch',
      state: await loadOnboardingState(ctx),
    };
  }
  const drafted = await describeBrand(env, {
    name: brand.name,
    domain,
    siteText: site.text,
  });
  if (!drafted) {
    await settleGenerationAttempt(db, prepared.claimId, 'failed');
    return { ok: false, reason: 'llm', state: await loadOnboardingState(ctx) };
  }
  const saved = await casWrite(ctx, opts.expectedVersion, {
    description: drafted.description,
    summary: drafted.summary,
    targetMarket: drafted.targetMarket,
    logoUrl: faviconUrl(domain),
    ...bumpRegen(prepared.profile, 'describe', opts.regenerate),
  });
  await settleGenerationAttempt(db, prepared.claimId, 'succeeded');
  if (!saved) {
    return generationWriteConflict(ctx);
  }
  return {
    ok: true,
    source: site.source,
    state: await loadOnboardingState(ctx),
  };
};

// Step 3 (AI): discover competitors via Exa company search + model curation.
// Soft-fails (ok:false) so the client falls back to manual add. Suggestions
// replace the draft; the user then adds/removes.
export const suggestCompetitors = async (
  ctx: OnboardingContext,
  opts: GenerationOpts,
): Promise<
  | { ok: true; state: OnboardingState }
  | { ok: false; reason: 'search' | 'llm'; state: OnboardingState }
  | OnboardingFailure
> => {
  const prepared = await prepareGeneration(ctx, 'competitors', opts);
  if (!prepared.proceed) {
    return prepared.failure;
  }
  const { db, env, workspaceId } = ctx;
  const brand = await brandFor(db, workspaceId);
  if (!brand) {
    await settleGenerationAttempt(db, prepared.claimId, 'failed');
    return { error: 'set up your brand first', status: 400 };
  }
  // Exa returns real indexed company pages; the model curates by candidate
  // number, so every suggested domain is backed by an actual search result.
  const discovered = await discoverCompetitors(env, {
    brand: brand.name,
    domains: brand.domains,
    summary: prepared.profile.summary ?? '',
  });
  if (discovered.length === 0) {
    await settleGenerationAttempt(db, prepared.claimId, 'failed');
    return {
      ok: false,
      reason: 'search',
      state: await loadOnboardingState(ctx),
    };
  }
  // Sanitise + dedupe: valid apex domains only, never the brand itself or
  // dupes. Alias suggestions pass through the same sanitiser as manual input;
  // the caseSensitive flag survives (it's the LLM's dictionary-word call).
  const brandDomains = new Set(brand.domains.map((d) => d.toLowerCase()));
  const domainCheck = domainField();
  const aliasCheck = singleLineText(1, 60);
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>([brand.name.toLowerCase()]);
  const competitors: DraftCompetitor[] = [];
  for (const item of discovered) {
    const name = item.name.trim();
    if (!name || seenNames.has(name.toLowerCase())) {
      continue;
    }
    const domains: string[] = [];
    for (const candidate of [item.domain, ...item.domains]) {
      const parsed = domainCheck.safeParse(candidate);
      if (!parsed.success) {
        continue;
      }
      const dom = parsed.data;
      if (
        brandDomains.has(dom) ||
        seenDomains.has(dom) ||
        domains.includes(dom)
      ) {
        continue;
      }
      domains.push(dom);
      if (domains.length >= 5) {
        break;
      }
    }
    if (domains.length === 0) {
      continue;
    }
    // An alias equal to the name is noise ("Alter aka Alter"), and dupes
    // among the suggestions collapse case-insensitively.
    const seenAliases = new Set<string>([name.toLowerCase()]);
    const aliases = item.aliases
      .flatMap((alias) => {
        const value = aliasCheck.safeParse(alias.value);
        if (!value.success || seenAliases.has(value.data.toLowerCase())) {
          return [];
        }
        seenAliases.add(value.data.toLowerCase());
        return [
          {
            value: value.data,
            caseSensitive: alias.caseSensitive ? true : undefined,
          },
        ];
      })
      .slice(0, 8);
    for (const dom of domains) {
      seenDomains.add(dom);
    }
    seenNames.add(name.toLowerCase());
    competitors.push({ name, domains, aliases });
    if (competitors.length >= 5) {
      break;
    }
  }
  if (competitors.length === 0) {
    await settleGenerationAttempt(db, prepared.claimId, 'failed');
    return { ok: false, reason: 'llm', state: await loadOnboardingState(ctx) };
  }
  const saved = await casWrite(ctx, opts.expectedVersion, {
    competitors,
    ...bumpRegen(prepared.profile, 'competitors', opts.regenerate),
  });
  await settleGenerationAttempt(db, prepared.claimId, 'succeeded');
  if (!saved) {
    return generationWriteConflict(ctx);
  }
  return { ok: true, state: await loadOnboardingState(ctx) };
};

// Step 4 (AI): generate the buyer-question set. Soft-fails to manual.
// Suggestions replace the draft; the user then adds/removes.
export const suggestPrompts = async (
  ctx: OnboardingContext,
  opts: GenerationOpts,
): Promise<
  | { ok: true; state: OnboardingState }
  | { ok: false; reason: 'llm'; state: OnboardingState }
  | OnboardingFailure
> => {
  const prepared = await prepareGeneration(ctx, 'prompts', opts);
  if (!prepared.proceed) {
    return prepared.failure;
  }
  const { db, env, workspaceId } = ctx;
  const brand = await brandFor(db, workspaceId);
  if (!brand) {
    await settleGenerationAttempt(db, prepared.claimId, 'failed');
    return { error: 'set up your brand first', status: 400 };
  }
  const generated = await generatePrompts(env, {
    brand: brand.name,
    domain: brand.domains[0] ?? '',
    summary: prepared.profile.summary ?? '',
    competitors: (prepared.profile.competitors ?? []).map((x) => x.name),
  });
  // Sanitise: 8-500 char text, valid category, dedupe, <=5 per category.
  const textCheck = multiLineText(8, 500);
  const categories = new Set<string>(PROMPT_CATEGORIES);
  const perCat = new Map<string, number>();
  const seen = new Set<string>();
  const out: { text: string; category: string }[] = [];
  const promptLimit = config(ctx).limits.maxActivePromptsPerWorkspace;
  for (const p of generated) {
    const category = p.category.trim();
    const parsedText = textCheck.safeParse(p.text);
    if (!parsedText.success || !categories.has(category)) {
      continue;
    }
    const t = parsedText.data;
    const dupeKey = t.toLowerCase();
    if (seen.has(dupeKey) || (perCat.get(category) ?? 0) >= 5) {
      continue;
    }
    seen.add(dupeKey);
    perCat.set(category, (perCat.get(category) ?? 0) + 1);
    out.push({ text: t, category });
    if (promptLimit !== null && out.length >= promptLimit) {
      break;
    }
  }
  if (out.length === 0) {
    await settleGenerationAttempt(db, prepared.claimId, 'failed');
    return { ok: false, reason: 'llm', state: await loadOnboardingState(ctx) };
  }
  const saved = await casWrite(ctx, opts.expectedVersion, {
    prompts: out,
    ...bumpRegen(prepared.profile, 'prompts', opts.regenerate),
  });
  await settleGenerationAttempt(db, prepared.claimId, 'succeeded');
  if (!saved) {
    return generationWriteConflict(ctx);
  }
  return { ok: true, state: await loadOnboardingState(ctx) };
};

// Save any subset of the draft (description/competitors/prompts/step). Editable
// prefills are cleaned through the same sanitisers as the manual dashboard.
export const updateDraft = async (
  ctx: OnboardingContext,
  data: UpdateDraftInput,
): Promise<OnboardingState | OnboardingFailure> => {
  const promptLimit = config(ctx).limits.maxActivePromptsPerWorkspace;
  if (
    data.prompts !== undefined &&
    promptLimit !== null &&
    data.prompts.length > promptLimit
  ) {
    return { error: promptLimitMessage(promptLimit), status: 409 };
  }
  const { expectedVersion, ...patch } = data;
  return mutateDraft(ctx, expectedVersion, () => patch);
};

const canonicalConfigurationFor = async (
  ctx: OnboardingContext,
): Promise<{
  ws: { name: string; version: number };
  brand: Awaited<ReturnType<typeof brandFor>>;
  profile: WorkspaceProfile;
  surfaces: ReturnType<typeof enabledSurfaces>;
  configuration: SetupConfiguration;
  hash: string;
} | null> => {
  const { db, workspaceId } = ctx;
  const ws = (
    await db
      .select({
        name: workspaces.name,
        version: workspaces.onboardingDraftVersion,
        surfaces: workspaces.surfaces,
        profile: workspaces.profile,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
  )[0];
  if (!ws) {
    return null;
  }
  const brand = await brandFor(db, workspaceId);
  const profile = (ws.profile ?? {}) as WorkspaceProfile;
  const surfaces = enabledSurfaces(
    ws.surfaces,
    config(ctx).limits.maxEnabledSurfacesPerWorkspace,
  );
  const configuration = canonicalizeSetupConfiguration({
    workspaceName: ws.name,
    brandName: brand?.name ?? '',
    brandDomains: brand?.domains ?? [],
    brandAliases: brand?.aliases ?? [],
    description: profile.description ?? '',
    summary: profile.summary ?? '',
    targetMarket: profile.targetMarket ?? '',
    competitors: (profile.competitors ?? []).map(normalizeCompetitor),
    prompts: normalizePrompts(profile.prompts ?? []),
    enabledSurfaces: surfaces,
  });
  return {
    ws: { name: ws.name, version: ws.version },
    brand,
    profile,
    surfaces,
    configuration,
    hash: await canonicalConfigurationHash(configuration),
  };
};

// Returns the exact canonical configuration a confirmation will be held to.
export const previewSetup = async (
  ctx: OnboardingContext,
): Promise<
  | {
      configuration: SetupConfiguration;
      draftVersion: number;
      configurationHash: string;
      configurationSchemaVersion: number;
      expectedPromptSurfaceChecks: number;
      warnings: string[];
    }
  | OnboardingFailure
> => {
  const built = await canonicalConfigurationFor(ctx);
  if (!built) {
    return { error: 'workspace not found', status: 404 };
  }
  const limits = config(ctx).limits;
  const warnings: string[] = [];
  if (
    limits.maxActivePromptsPerWorkspace !== null &&
    built.profile.prompts &&
    built.profile.prompts.length > limits.maxActivePromptsPerWorkspace
  ) {
    warnings.push(
      `only the first ${limits.maxActivePromptsPerWorkspace} prompts will run`,
    );
  }
  return {
    configuration: built.configuration,
    draftVersion: built.ws.version,
    configurationHash: built.hash,
    configurationSchemaVersion: CONFIGURATION_SCHEMA_VERSION,
    expectedPromptSurfaceChecks:
      normalizePrompts(built.profile.prompts ?? []).length *
      built.surfaces.length,
    warnings,
  };
};

// Materialise the drafted competitors + prompts and fire the onboard runs
// (preliminary 1 prompt/category + background for the rest, sample=1). Shared
// by the dashboard commit and the MCP confirm — one code path, one behavior.
const materializeDraft = async (
  ctx: OnboardingContext,
  profile: WorkspaceProfile,
): Promise<{
  preliminaryRunId: number | null;
  backgroundRunId: number | null;
}> => {
  const { db, env, workspaceId } = ctx;
  const promptLimit = config(ctx).limits.maxActivePromptsPerWorkspace;

  const competitorDrafts = (profile.competitors ?? [])
    .map((c, i) => normalizeCompetitor(c, i))
    .filter((comp) => comp.name.trim() && comp.domains.length > 0);

  const existingPrompts = await db
    .select({
      active: prompts.active,
      text: prompts.text,
    })
    .from(prompts)
    .where(eq(prompts.workspaceId, workspaceId));
  const existingPromptTexts = new Set(existingPrompts.map((p) => p.text));
  const newPromptTexts = new Set(
    (profile.prompts ?? [])
      .map((prompt) => prompt.text)
      .filter((text) => !existingPromptTexts.has(text)),
  );
  if (
    promptLimit !== null &&
    existingPrompts.filter((prompt) => prompt.active).length +
      newPromptTexts.size >
      promptLimit
  ) {
    throw new Error(promptLimitMessage(promptLimit));
  }

  const existing = await db
    .select()
    .from(entities)
    .where(eq(entities.workspaceId, workspaceId));
  const takenNames = new Set(existing.map((e) => e.name.toLowerCase()));
  let order = existing.reduce((max, e) => Math.max(max, e.sortOrder), -1);
  for (const comp of competitorDrafts) {
    if (takenNames.has(comp.name.toLowerCase()) || comp.domains.length === 0) {
      continue;
    }
    order += 1;
    await db
      .insert(entities)
      .values({
        workspaceId,
        name: comp.name,
        domains: comp.domains,
        aliases: comp.aliases,
        isBrand: false,
        sortOrder: order,
      })
      .onConflictDoNothing({ target: [entities.workspaceId, entities.name] });
    takenNames.add(comp.name.toLowerCase());
  }

  for (const p of profile.prompts ?? []) {
    const insertedId = await insertActivePrompt(
      env,
      workspaceId,
      p.text,
      p.category ? [p.category] : [],
      promptLimit,
    );
    if (insertedId === null && !existingPromptTexts.has(p.text)) {
      if (promptLimit === null) {
        throw new Error('unlimited onboarding prompt insert returned no row');
      }
      throw new Error(promptLimitMessage(promptLimit));
    }
    existingPromptTexts.add(p.text);
  }

  const promptRows = await db
    .select({ id: prompts.id, tags: prompts.tags })
    .from(prompts)
    .where(and(eq(prompts.workspaceId, workspaceId), eq(prompts.active, true)));
  const byCategory = new Map<string, number[]>();
  for (const p of promptRows) {
    const cat = p.tags[0] ?? 'Other';
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), p.id]);
  }
  const preliminaryIds = [...byCategory.values()]
    .map((ids) => ids[0])
    .filter((id): id is number => id !== undefined);
  const preliminarySet = new Set(preliminaryIds);
  const backgroundIds = promptRows
    .map((p) => p.id)
    .filter((id) => !preliminarySet.has(id));
  const date = new Date().toISOString().slice(0, 10);
  let preliminaryRunId: number | null = null;
  let backgroundRunId: number | null = null;
  if (preliminaryIds.length > 0) {
    const run = await createRun(
      env,
      workspaceId,
      'onboard',
      `onboard:${workspaceId}`,
      date,
      {
        promptIds: preliminaryIds,
        samples: 1,
      },
    );
    preliminaryRunId = run.runId;
  }
  if (backgroundIds.length > 0) {
    const run = await createRun(
      env,
      workspaceId,
      'onboard',
      `onboard-bg:${workspaceId}`,
      date,
      {
        promptIds: backgroundIds,
        samples: 1,
      },
    );
    backgroundRunId = run.runId;
  }
  return { preliminaryRunId, backgroundRunId };
};

const reportUrlFor = (
  ctx: OnboardingContext,
  setupId: number,
): string | null =>
  ctx.env.DASHBOARD_ORIGIN
    ? `${ctx.env.DASHBOARD_ORIGIN}/w/${ctx.workspaceId}/onboarding/report/${setupId}`
    : null;

// Shared tail of both confirmation paths: insert the immutable commit row,
// materialize, pin the run ids, mark the workspace committed. A failure here
// voids the claim (dispatch never started) so the user can retry cleanly.
const finalizeSetup = async (
  ctx: OnboardingContext,
  input: {
    built: NonNullable<Awaited<ReturnType<typeof canonicalConfigurationFor>>>;
    idempotencyKey: string;
    claimId: number;
  },
): Promise<
  | { ok: true; setupId: number; reportUrl: string | null; existing: boolean }
  | OnboardingFailure
> => {
  const { db, workspaceId } = ctx;
  const inserted = (
    await db
      .insert(setupCommits)
      .values({
        workspaceId,
        draftVersion: input.built.ws.version,
        configurationSnapshot: input.built.configuration,
        configurationSchemaVersion: CONFIGURATION_SCHEMA_VERSION,
        configurationHash: input.built.hash,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: setupCommits.id })
  )[0];
  if (!inserted) {
    const existingRow = (
      await db
        .select()
        .from(setupCommits)
        .where(eq(setupCommits.idempotencyKey, input.idempotencyKey))
    )[0];
    if (existingRow) {
      return {
        ok: true,
        setupId: existingRow.id,
        reportUrl: reportUrlFor(ctx, existingRow.id),
        existing: true,
      };
    }
    return alreadyCommitted;
  }
  try {
    const runs = await materializeDraft(ctx, input.built.profile);
    await db
      .update(setupCommits)
      .set({
        preliminaryRunId: runs.preliminaryRunId,
        backgroundRunId: runs.backgroundRunId,
        completedAt: Date.now(),
      })
      .where(eq(setupCommits.id, inserted.id));
    await db
      .update(workspaces)
      .set({
        profile: { ...input.built.profile, step: 'report', committed: true },
        onboardingDraftVersion: input.built.ws.version + 1,
      })
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.onboardingDraftVersion, input.built.ws.version),
        ),
      );
    return {
      ok: true,
      setupId: inserted.id,
      reportUrl: reportUrlFor(ctx, inserted.id),
      existing: false,
    };
  } catch (error) {
    // Dispatch has not started (no queue messages yet), so releasing here is
    // provably unspent; the operator void path is for later failures.
    const claim = (
      await db
        .select({ id: setupUsage.id })
        .from(setupUsage)
        .where(eq(setupUsage.id, input.claimId))
    )[0];
    await db
      .update(setupCommits)
      .set({
        claimStatus: 'void',
        voidedAt: Date.now(),
        voidReason: 'setup materialization failed',
      })
      .where(eq(setupCommits.id, inserted.id));
    if (claim) {
      await releaseReportClaim(db, {
        claimId: input.claimId,
        userId: ctx.userId,
        workspaceId,
      });
    }
    throw error;
  }
};

// MCP confirm_setup: the only path that turns an approved preview into a run
// group. Integrity = current version + server-recomputed canonical hash.
export const confirmSetup = async (
  ctx: OnboardingContext,
  args: {
    expectedVersion: number;
    configurationHash: string;
    idempotencyKey: string;
  },
): Promise<
  | {
      ok: true;
      setupId: number;
      reportUrl: string | null;
      existing: boolean;
    }
  | OnboardingFailure
> => {
  const { db, workspaceId } = ctx;
  const built = await canonicalConfigurationFor(ctx);
  if (!built) {
    return { error: 'workspace not found', status: 404 };
  }
  if (built.ws.version !== args.expectedVersion) {
    return conflictFailure(ctx, built.ws.version);
  }
  if (built.hash !== args.configurationHash) {
    return {
      error: 'the approved preview no longer matches the current setup',
      status: 409,
    };
  }
  const active = await activeSetupCommit(db, workspaceId);
  if (active) {
    if (active.idempotencyKey === args.idempotencyKey) {
      return {
        ok: true,
        setupId: active.id,
        reportUrl: reportUrlFor(ctx, active.id),
        existing: true,
      };
    }
    return alreadyCommitted;
  }
  const claim = await claimFreeReport(db, ctx.env, {
    userId: ctx.userId,
    workspaceId,
    isAdmin: config(ctx).isAdmin,
    idempotencyKey: `report:${args.idempotencyKey}`,
  });
  if (!claim.ok) {
    return budgetFailure(claim);
  }
  return finalizeSetup(ctx, {
    built,
    idempotencyKey: args.idempotencyKey,
    claimId: claim.claimId,
  });
};

// Dashboard commit: same budget claim, same commit row, same materialization —
// the only difference is that integrity comes from the server-recomputed hash
// over the draft the user just reviewed.
export const commitOnboarding = async (
  ctx: OnboardingContext,
  args: { expectedVersion: number },
): Promise<{ ok: true; setupId: number } | OnboardingFailure> => {
  const built = await canonicalConfigurationFor(ctx);
  if (!built) {
    return { error: 'workspace not found', status: 404 };
  }
  if (built.ws.version !== args.expectedVersion) {
    return conflictFailure(ctx, built.ws.version);
  }
  if (await activeSetupCommit(ctx.db, ctx.workspaceId)) {
    return alreadyCommitted;
  }
  const claim = await claimFreeReport(ctx.db, ctx.env, {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    isAdmin: config(ctx).isAdmin,
  });
  if (!claim.ok) {
    return budgetFailure(claim);
  }
  const result = await finalizeSetup(ctx, {
    built,
    idempotencyKey: crypto.randomUUID(),
    claimId: claim.claimId,
  });
  if ('error' in result) {
    return result;
  }
  return { ok: true, setupId: result.setupId };
};

// The last wizard step: the user has read the report and is leaving for the
// dashboard. Only now is the workspace onboarded (RequireOnboarded's gate), so
// abandoning the report and coming back resumes on the report.
export const completeOnboarding = async (
  ctx: OnboardingContext,
): Promise<{ ok: true } | OnboardingFailure> => {
  const { db, workspaceId } = ctx;
  const profile = await getProfile(db, workspaceId);
  if (!profile.committed) {
    return { error: 'finish the setup steps first', status: 400 };
  }
  await db
    .update(workspaces)
    .set({ onboardingCompleted: true })
    .where(eq(workspaces.id, workspaceId));
  return { ok: true };
};
