import { promptLimitMessage } from '@refd/core/config';
import { siteMetadataSchema } from '@refd/core/site-metadata';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  entities,
  prompts,
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

// The canonical competitor draft shape; upgrades legacy single-`domain` drafts
// so an in-flight wizard survives the shape change.
const normalizeCompetitor = (comp: {
  name: string;
  domain?: string;
  domains?: string[];
  aliases?: { value: string; caseSensitive?: boolean }[];
}): {
  name: string;
  domains: string[];
  aliases: { value: string; caseSensitive?: boolean }[];
} => ({
  name: comp.name,
  domains: comp.domains ?? (comp.domain ? [comp.domain] : []),
  aliases: comp.aliases ?? [],
});

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
      prompts: profile.prompts ?? [],
    },
    regenLimit: REGEN_LIMIT,
    regen: {
      describe: profile.regen?.describe ?? 0,
      competitors: profile.regen?.competitors ?? 0,
      prompts: profile.regen?.prompts ?? 0,
    },
  };
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
): Promise<OnboardingState> => {
  const { db, workspaceId } = ctx;
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
  await mergeProfile(db, workspaceId, {
    step: 'describe',
    siteMetadata: undefined,
  });
  return loadOnboardingState(ctx);
};

// Step 2 (AI): fetch the brand's site and draft an editable description. Every
// failure is soft (ok:false) so the client falls back to manual entry — the
// wizard must never dead-end on a flaky site or model call.
export const draftDescription = async (
  ctx: OnboardingContext,
  opts: { regenerate?: boolean } = {},
): Promise<
  | { ok: true; source: string; state: OnboardingState }
  | { ok: false; reason: 'fetch' | 'llm'; state: OnboardingState }
  | OnboardingFailure
> => {
  const { db, env, workspaceId } = ctx;
  const profile = await getProfile(db, workspaceId);
  if (!regenAllowed(profile, 'describe', opts.regenerate)) {
    return regenSpent;
  }
  const brand = await brandFor(db, workspaceId);
  const domain = brand?.domains[0];
  if (!brand || !domain) {
    return {
      ok: false,
      reason: 'fetch',
      state: await loadOnboardingState(ctx),
    };
  }
  // The logo is deterministic from the domain — set it even when text extraction fails.
  await mergeProfile(db, workspaceId, { logoUrl: faviconUrl(domain) });

  const site = await fetchSiteText(env, domain);
  if (!site) {
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
    return { ok: false, reason: 'llm', state: await loadOnboardingState(ctx) };
  }
  await mergeProfile(db, workspaceId, {
    description: drafted.description,
    summary: drafted.summary,
    targetMarket: drafted.targetMarket,
    ...bumpRegen(profile, 'describe', opts.regenerate),
  });
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
  opts: { regenerate?: boolean } = {},
): Promise<
  | { ok: true; state: OnboardingState }
  | { ok: false; reason: 'search' | 'llm'; state: OnboardingState }
  | OnboardingFailure
> => {
  const { db, env, workspaceId } = ctx;
  const brand = await brandFor(db, workspaceId);
  if (!brand) {
    return { error: 'set up your brand first', status: 400 };
  }
  const profile = await getProfile(db, workspaceId);
  if (!regenAllowed(profile, 'competitors', opts.regenerate)) {
    return regenSpent;
  }
  // Exa returns real indexed company pages; the model curates by candidate
  // number, so every suggested domain is backed by an actual search result.
  const discovered = await discoverCompetitors(env, {
    brand: brand.name,
    domains: brand.domains,
    summary: profile.summary ?? '',
  });
  if (discovered.length === 0) {
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
  const competitors: NonNullable<WorkspaceProfile['competitors']> = [];
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
    return { ok: false, reason: 'llm', state: await loadOnboardingState(ctx) };
  }
  await mergeProfile(db, workspaceId, {
    competitors,
    ...bumpRegen(profile, 'competitors', opts.regenerate),
  });
  return { ok: true, state: await loadOnboardingState(ctx) };
};

// Step 4 (AI): generate the buyer-question set. Soft-fails to manual.
// Suggestions replace the draft; the user then adds/removes.
export const suggestPrompts = async (
  ctx: OnboardingContext,
  opts: { regenerate?: boolean } = {},
): Promise<
  | { ok: true; state: OnboardingState }
  | { ok: false; reason: 'llm'; state: OnboardingState }
  | OnboardingFailure
> => {
  const { db, env, workspaceId } = ctx;
  const brand = await brandFor(db, workspaceId);
  if (!brand) {
    return { error: 'set up your brand first', status: 400 };
  }
  const profile = await getProfile(db, workspaceId);
  if (!regenAllowed(profile, 'prompts', opts.regenerate)) {
    return regenSpent;
  }
  const generated = await generatePrompts(env, {
    brand: brand.name,
    domain: brand.domains[0] ?? '',
    summary: profile.summary ?? '',
    competitors: (profile.competitors ?? []).map((x) => x.name),
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
    return { ok: false, reason: 'llm', state: await loadOnboardingState(ctx) };
  }
  await mergeProfile(db, workspaceId, {
    prompts: out,
    ...bumpRegen(profile, 'prompts', opts.regenerate),
  });
  return { ok: true, state: await loadOnboardingState(ctx) };
};

// Save any subset of the draft (description/competitors/prompts/step). Editable
// prefills are cleaned through the same sanitisers as the manual dashboard.
export const updateDraft = async (
  ctx: OnboardingContext,
  data: UpdateDraftInput,
): Promise<OnboardingState | OnboardingFailure> => {
  const { db, workspaceId } = ctx;
  const promptLimit = config(ctx).limits.maxActivePromptsPerWorkspace;
  if (
    data.prompts !== undefined &&
    promptLimit !== null &&
    data.prompts.length > promptLimit
  ) {
    return { error: promptLimitMessage(promptLimit), status: 409 };
  }
  await mergeProfile(db, workspaceId, data);
  return loadOnboardingState(ctx);
};

// Materialise the drafted competitors + prompts and fire the onboard runs. This
// does NOT finish onboarding: the live report is the last wizard step, and
// completeOnboarding is what releases the workspace to the dashboard.
export const commitOnboarding = async (
  ctx: OnboardingContext,
): Promise<{ ok: true } | OnboardingFailure> => {
  const { db, env, workspaceId } = ctx;
  const profile = await getProfile(db, workspaceId);
  const promptLimit = config(ctx).limits.maxActivePromptsPerWorkspace;
  const brand = await brandFor(db, workspaceId);
  if (!brand) {
    return { error: 'set up your brand first', status: 400 };
  }

  const competitorDrafts = (profile.competitors ?? [])
    .map(normalizeCompetitor)
    .filter((comp) => comp.name.trim() && comp.domains.length > 0);
  if (competitorDrafts.length === 0) {
    return { error: 'add at least one competitor first', status: 400 };
  }

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
    return { error: promptLimitMessage(promptLimit), status: 409 };
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
      return { error: promptLimitMessage(promptLimit), status: 409 };
    }
    existingPromptTexts.add(p.text);
  }

  // Fire the preliminary run (1 prompt/category) + a background run for the rest,
  // both at sample=1 across the enabled surfaces. The report screen watches the
  // preliminary run.
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
  if (preliminaryIds.length > 0) {
    await createRun(
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
  }
  if (backgroundIds.length > 0) {
    await createRun(
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
  }

  await db
    .update(workspaces)
    .set({ profile: { ...profile, step: 'report', committed: true } })
    .where(eq(workspaces.id, workspaceId));
  return { ok: true };
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
