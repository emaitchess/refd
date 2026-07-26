import { and, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { promptLimitMessage } from '../../shared/config';
import { siteMetadataSchema } from '../../shared/site-metadata';
import type { WorkspaceBindings } from '../auth/middleware';
import type { Db } from '../db/client';
import { getDb } from '../db/client';
import {
  entities,
  prompts,
  type WorkspaceProfile,
  workspaces,
} from '../db/schema';
import { createRun } from '../ingest/runs';
import { discoverCompetitors } from '../lib/exa';
import { parseBody } from '../lib/http';
import { describeBrand, generatePrompts, PROMPT_CATEGORIES } from '../lib/llm';
import { insertActivePrompt } from '../lib/prompt-limit';
import { domainField, multiLineText, singleLineText } from '../lib/sanitize';
import { fetchSiteMetadata, fetchSiteText } from '../lib/site-fetch';
import { configForUser } from '../lib/user-config';
import { enabledSurfaces } from '../providers/types';

// favicon.im/google favicons — deterministic, no auth. Used as the brand logo.
const faviconUrl = (domain: string): string =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

export const onboardingRoutes = new Hono<WorkspaceBindings>();

const STEPS = [
  'brand',
  'describe',
  'competitors',
  'prompts',
  'report',
] as const;

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

// Each AI step drafts itself once on entry for free; a manual regenerate is a
// second model call, so it's allowed once per step and then refused. The client
// checks the same counts to warn before spending the call.
const REGEN_LIMIT = 1;
type RegenKey = keyof NonNullable<WorkspaceProfile['regen']>;
const regenBody = z.object({ regenerate: z.boolean().optional() });

const aliasSchema = z.object({
  value: singleLineText(1, 60),
  caseSensitive: z.boolean().optional(),
});
type AliasDraft = z.infer<typeof aliasSchema>;

// The canonical competitor draft shape; upgrades legacy single-`domain` drafts
// so an in-flight wizard survives the shape change.
const normalizeCompetitor = (comp: {
  name: string;
  domain?: string;
  domains?: string[];
  aliases?: AliasDraft[];
}): { name: string; domains: string[]; aliases: AliasDraft[] } => ({
  name: comp.name,
  domains: comp.domains ?? (comp.domain ? [comp.domain] : []),
  aliases: comp.aliases ?? [],
});

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

const regenSpent = { error: 'regenerate limit reached' } as const;

const storedSiteMetadata = (value: unknown) => {
  const parsed = siteMetadataSchema.safeParse(value);
  return parsed.success && Object.values(parsed.data).some(Boolean)
    ? parsed.data
    : null;
};

// The resumable wizard state: the committed brand entity + the profile draft
// (description/competitors/prompts) + the completion flag. Competitors and
// prompts stay as drafts here until `commit` materialises them as real rows.
const loadState = async (
  c: Context<WorkspaceBindings>,
  db: Db,
  wsId: number,
) => {
  const config = configForUser(c.get('user').email, c.env.ADMIN_EMAILS);
  const ws = (
    await db.select().from(workspaces).where(eq(workspaces.id, wsId))
  )[0];
  const brand = (
    await db
      .select()
      .from(entities)
      .where(and(eq(entities.workspaceId, wsId), eq(entities.isBrand, true)))
  )[0];
  const profile = (ws?.profile ?? {}) as WorkspaceProfile;
  return {
    onboardingCompleted: ws?.onboardingCompleted ?? false,
    committed: profile.committed ?? false,
    step: profile.step ?? (brand ? 'describe' : 'brand'),
    surfaces: enabledSurfaces(
      ws?.surfaces ?? null,
      config.limits.maxEnabledSurfacesPerWorkspace,
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

onboardingRoutes.get('/', async (c) => {
  const db = getDb(c.env);
  return c.json(await loadState(c, db, c.get('workspace').id));
});

onboardingRoutes.get('/site-metadata', async (c) => {
  const db = getDb(c.env);
  const wsId = c.get('workspace').id;
  const profile = await getProfile(db, wsId);
  const cached = storedSiteMetadata(profile.siteMetadata);
  if (cached) {
    return c.json({ metadata: cached });
  }
  const brand = (
    await db
      .select()
      .from(entities)
      .where(and(eq(entities.workspaceId, wsId), eq(entities.isBrand, true)))
  )[0];
  const domain = brand?.domains[0];
  const metadata = domain ? await fetchSiteMetadata(c.env, domain) : null;
  if (metadata) {
    await mergeProfile(db, wsId, { siteMetadata: metadata });
  }
  return c.json({ metadata });
});

const brandSchema = z.object({
  name: singleLineText(1, 100),
  domains: z.array(domainField()).min(1).max(10),
  // Plain values from the wizard input; the Settings editor is where
  // caseSensitive flags get managed.
  aliases: z.array(singleLineText(1, 60)).max(10).default([]),
});

// Step 1: create (or update) the brand entity so RequireOnboarded's later steps
// have something to enrich. Idempotent — safe to resubmit on resume.
onboardingRoutes.post('/brand', async (c) => {
  const data = await parseBody(c, brandSchema);
  const db = getDb(c.env);
  const ws = c.get('workspace');
  const existing = (
    await db
      .select()
      .from(entities)
      .where(and(eq(entities.workspaceId, ws.id), eq(entities.isBrand, true)))
  )[0];
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
        workspaceId: ws.id,
        name: data.name,
        domains: data.domains,
        aliases,
        isBrand: true,
        sortOrder: 0,
      })
      .onConflictDoNothing({ target: [entities.workspaceId, entities.name] });
  }
  // Tidy the register-time default workspace name (email local part) to the brand.
  if (ws.name === c.get('user').email.split('@')[0]) {
    await db
      .update(workspaces)
      .set({ name: data.name })
      .where(eq(workspaces.id, ws.id));
  }
  await mergeProfile(db, ws.id, {
    step: 'describe',
    siteMetadata: undefined,
  });
  return c.json(await loadState(c, db, ws.id));
});

// Step 2 (AI): fetch the brand's site and draft an editable description via
// glm-5.2. Every failure is soft (200 with ok:false) so the client falls back to
// manual entry — the wizard must never dead-end on a flaky site or model call.
onboardingRoutes.post('/extract', async (c) => {
  const { regenerate } = await parseBody(c, regenBody);
  const db = getDb(c.env);
  const wsId = c.get('workspace').id;
  const profile = await getProfile(db, wsId);
  if (!regenAllowed(profile, 'describe', regenerate)) {
    return c.json(regenSpent, 429);
  }
  const brand = (
    await db
      .select()
      .from(entities)
      .where(and(eq(entities.workspaceId, wsId), eq(entities.isBrand, true)))
  )[0];
  const domain = brand?.domains[0];
  if (!brand || !domain) {
    return c.json({
      ok: false,
      reason: 'fetch',
      state: await loadState(c, db, wsId),
    });
  }
  // The logo is deterministic from the domain — set it even when text extraction fails.
  await mergeProfile(db, wsId, { logoUrl: faviconUrl(domain) });

  const site = await fetchSiteText(c.env, domain);
  if (!site) {
    return c.json({
      ok: false,
      reason: 'fetch',
      state: await loadState(c, db, wsId),
    });
  }
  const drafted = await describeBrand(c.env, {
    name: brand.name,
    domain,
    siteText: site.text,
  });
  if (!drafted) {
    return c.json({
      ok: false,
      reason: 'llm',
      state: await loadState(c, db, wsId),
    });
  }
  await mergeProfile(db, wsId, {
    description: drafted.description,
    summary: drafted.summary,
    targetMarket: drafted.targetMarket,
    ...bumpRegen(profile, 'describe', regenerate),
  });
  return c.json({
    ok: true,
    source: site.source,
    state: await loadState(c, db, wsId),
  });
});

// Step 3 (AI): discover competitors via parallel.ai Search + glm-5.2 curation.
// Soft-fails (ok:false) so the client falls back to manual add. Suggestions
// replace the draft; the user then adds/removes.
onboardingRoutes.post('/competitors', async (c) => {
  const { regenerate } = await parseBody(c, regenBody);
  const db = getDb(c.env);
  const wsId = c.get('workspace').id;
  const brand = (
    await db
      .select()
      .from(entities)
      .where(and(eq(entities.workspaceId, wsId), eq(entities.isBrand, true)))
  )[0];
  if (!brand) {
    return c.json({ error: 'set up your brand first' }, 400);
  }
  const profile = await getProfile(db, wsId);
  if (!regenAllowed(profile, 'competitors', regenerate)) {
    return c.json(regenSpent, 429);
  }
  // Exa returns real indexed company pages; glm-5.2 curates by candidate
  // number, so every suggested domain is backed by an actual search result.
  const discovered = await discoverCompetitors(c.env, {
    brand: brand.name,
    domains: brand.domains,
    summary: profile.summary ?? '',
  });
  if (discovered.length === 0) {
    return c.json({
      ok: false,
      reason: 'search',
      state: await loadState(c, db, wsId),
    });
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
    return c.json({
      ok: false,
      reason: 'llm',
      state: await loadState(c, db, wsId),
    });
  }
  await mergeProfile(db, wsId, {
    competitors,
    ...bumpRegen(profile, 'competitors', regenerate),
  });
  return c.json({ ok: true, state: await loadState(c, db, wsId) });
});

// Step 4 (AI): generate the buyer-question set via glm-5.2. Soft-fails to manual.
// Suggestions replace the draft; the user then adds/removes.
onboardingRoutes.post('/prompts', async (c) => {
  const { regenerate } = await parseBody(c, regenBody);
  const db = getDb(c.env);
  const wsId = c.get('workspace').id;
  const brand = (
    await db
      .select()
      .from(entities)
      .where(and(eq(entities.workspaceId, wsId), eq(entities.isBrand, true)))
  )[0];
  if (!brand) {
    return c.json({ error: 'set up your brand first' }, 400);
  }
  const profile = await getProfile(db, wsId);
  if (!regenAllowed(profile, 'prompts', regenerate)) {
    return c.json(regenSpent, 429);
  }
  const generated = await generatePrompts(c.env, {
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
  const promptLimit = configForUser(c.get('user').email, c.env.ADMIN_EMAILS)
    .limits.maxActivePromptsPerWorkspace;
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
    return c.json({
      ok: false,
      reason: 'llm',
      state: await loadState(c, db, wsId),
    });
  }
  await mergeProfile(db, wsId, {
    prompts: out,
    ...bumpRegen(profile, 'prompts', regenerate),
  });
  return c.json({ ok: true, state: await loadState(c, db, wsId) });
});

const competitorDraft = z.object({
  name: singleLineText(1, 100),
  domains: z.array(domainField()).min(1).max(5),
  aliases: z.array(aliasSchema).max(8).default([]),
});
const promptDraft = z.object({
  text: multiLineText(8, 500),
  category: singleLineText(1, 40),
});

// A high request-shape ceiling protects parsing even when an administrator has
// no product-level prompt limit.
const MAX_PROMPTS_PER_REQUEST = 1000;

const patchSchema = z.object({
  step: z.enum(STEPS).optional(),
  description: multiLineText(0, 800).optional(),
  summary: multiLineText(0, 1500).optional(),
  targetMarket: singleLineText(0, 200).optional(),
  logoUrl: z.string().trim().max(400).optional(),
  competitors: z.array(competitorDraft).max(10).optional(),
  prompts: z.array(promptDraft).max(MAX_PROMPTS_PER_REQUEST).optional(),
});

// Save any subset of the draft (description/competitors/prompts/step). Editable
// prefills are cleaned through the same sanitisers as the manual dashboard.
onboardingRoutes.patch('/', async (c) => {
  const data = await parseBody(c, patchSchema);
  const db = getDb(c.env);
  const wsId = c.get('workspace').id;
  const promptLimit = configForUser(c.get('user').email, c.env.ADMIN_EMAILS)
    .limits.maxActivePromptsPerWorkspace;
  if (
    data.prompts !== undefined &&
    promptLimit !== null &&
    data.prompts.length > promptLimit
  ) {
    return c.json({ error: promptLimitMessage(promptLimit) }, 409);
  }
  await mergeProfile(db, wsId, data);
  return c.json(await loadState(c, db, wsId));
});

// Materialise the drafted competitors + prompts and fire the onboard runs. This
// does NOT finish onboarding: the live report is the last wizard step, and
// `complete` below is what releases the workspace to the dashboard.
onboardingRoutes.post('/commit', async (c) => {
  const db = getDb(c.env);
  const wsId = c.get('workspace').id;
  const profile = await getProfile(db, wsId);
  const promptLimit = configForUser(c.get('user').email, c.env.ADMIN_EMAILS)
    .limits.maxActivePromptsPerWorkspace;
  const brand = (
    await db
      .select()
      .from(entities)
      .where(and(eq(entities.workspaceId, wsId), eq(entities.isBrand, true)))
  )[0];
  if (!brand) {
    return c.json({ error: 'set up your brand first' }, 400);
  }

  const competitorDrafts = (profile.competitors ?? [])
    .map(normalizeCompetitor)
    .filter((comp) => comp.name.trim() && comp.domains.length > 0);
  if (competitorDrafts.length === 0) {
    return c.json({ error: 'add at least one competitor first' }, 400);
  }

  const existingPrompts = await db
    .select({
      active: prompts.active,
      text: prompts.text,
    })
    .from(prompts)
    .where(eq(prompts.workspaceId, wsId));
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
    return c.json({ error: promptLimitMessage(promptLimit) }, 409);
  }

  const existing = await db
    .select()
    .from(entities)
    .where(eq(entities.workspaceId, wsId));
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
        workspaceId: wsId,
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
      c.env,
      wsId,
      p.text,
      p.category ? [p.category] : [],
      promptLimit,
    );
    if (insertedId === null && !existingPromptTexts.has(p.text)) {
      if (promptLimit === null) {
        throw new Error('unlimited onboarding prompt insert returned no row');
      }
      return c.json({ error: promptLimitMessage(promptLimit) }, 409);
    }
    existingPromptTexts.add(p.text);
  }

  // Fire the preliminary run (1 prompt/category) + a background run for the rest,
  // both at sample=1 across the enabled surfaces. The report screen watches the
  // preliminary run. Never fail commit if a run can't start.
  const promptRows = await db
    .select({ id: prompts.id, tags: prompts.tags })
    .from(prompts)
    .where(and(eq(prompts.workspaceId, wsId), eq(prompts.active, true)));
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
  try {
    if (preliminaryIds.length > 0) {
      await createRun(c.env, wsId, 'onboard', `onboard:${wsId}`, date, {
        promptIds: preliminaryIds,
        samples: 1,
      });
    }
    if (backgroundIds.length > 0) {
      await createRun(c.env, wsId, 'onboard', `onboard-bg:${wsId}`, date, {
        promptIds: backgroundIds,
        samples: 1,
      });
    }
  } catch (error) {
    console.error(`onboard run failed for ws ${wsId}`, error);
  }

  await db
    .update(workspaces)
    .set({ profile: { ...profile, step: 'report', committed: true } })
    .where(eq(workspaces.id, wsId));
  return c.json({ ok: true });
});

// The last wizard step: the user has read the report and is leaving for the
// dashboard. Only now is the workspace onboarded (RequireOnboarded's gate), so
// abandoning the report and coming back resumes on the report.
onboardingRoutes.post('/complete', async (c) => {
  const db = getDb(c.env);
  const wsId = c.get('workspace').id;
  const profile = await getProfile(db, wsId);
  if (!profile.committed) {
    return c.json({ error: 'finish the setup steps first' }, 400);
  }
  await db
    .update(workspaces)
    .set({ onboardingCompleted: true })
    .where(eq(workspaces.id, wsId));
  return c.json({ ok: true });
});
