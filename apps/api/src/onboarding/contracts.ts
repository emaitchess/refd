import type { Alias } from '@refd/core/mentions';
import type { SiteMetadata } from '@refd/core/site-metadata';
import { z } from 'zod';
import { PROMPT_CATEGORIES } from '../lib/llm';
import { domainField, multiLineText, singleLineText } from '../lib/sanitize';
import { SURFACES, type Surface } from '../providers/types';

export const STEPS = [
  'brand',
  'describe',
  'competitors',
  'prompts',
  'report',
] as const;

export type OnboardingStep = (typeof STEPS)[number];

// The brand step seeds the pointer forward, never backward: re-saving brand
// details while the wizard already sits on a later step must not rewind it.
export const stepAfterBrandSave = (
  step: OnboardingStep | undefined,
): OnboardingStep => {
  const order = STEPS as readonly OnboardingStep[];
  const current = step ?? 'brand';
  return order.indexOf(current) > order.indexOf('describe')
    ? current
    : 'describe';
};

// Each AI step drafts itself once on entry for free; a manual regenerate is a
// second model call, so it's allowed once per step and then refused. The client
// checks the same counts to warn before spending the call.
export const REGEN_LIMIT = 1;

export const regenBody = z.object({ regenerate: z.boolean().optional() });

// Optimistic concurrency: every draft mutation carries the version it was read
// at. A stale version returns the structured conflict with the current state.
export const expectedVersionField = z.number().int().nonnegative();

export const brandRequestSchema = z.object({
  name: singleLineText(1, 100),
  domains: z.array(domainField()).min(1).max(10),
  // Plain values from the wizard input; the Settings editor is where
  // caseSensitive flags get managed.
  aliases: z.array(singleLineText(1, 60)).max(10).default([]),
  expectedVersion: expectedVersionField,
});
export type BrandInput = z.infer<typeof brandRequestSchema>;

export const steeringRequestSchema = z.object({
  total: z.number().int().min(1).max(100).optional(),
  focus: multiLineText(0, 400).optional(),
});

// Caller-supplied idempotency keys pin duplicate submissions across retries.
// Any stable opaque string works; agents do not need a UUID generator.
const idempotencyKeyField = z.string().trim().min(8).max(64);

export const generationRequestSchema = regenBody.extend({
  expectedVersion: expectedVersionField,
  idempotencyKey: idempotencyKeyField.optional(),
  steering: steeringRequestSchema.optional(),
});

export const aliasSchema = z.object({
  value: singleLineText(1, 60),
  caseSensitive: z.boolean().optional(),
});
export type AliasDraft = z.infer<typeof aliasSchema>;

const draftIdField = z.string().min(8).max(64);

export const competitorDraft = z.object({
  draftId: draftIdField.optional(),
  name: singleLineText(1, 100),
  domains: z.array(domainField()).min(1).max(5),
  aliases: z.array(aliasSchema).max(8).default([]),
});

// Categories become the prompt's only tag and drive the onboarding report's
// 1-prompt-per-category selection, so a mistyped one would silently fragment
// grouping. Fold case onto the canonical set before enum validation.
export const canonicalPromptCategory = (value: string) =>
  PROMPT_CATEGORIES.find(
    (category) => category.toLowerCase() === value.trim().toLowerCase(),
  );
export const categorySchema = singleLineText(1, 40)
  .transform((value) => canonicalPromptCategory(value) ?? value)
  .pipe(
    z.enum(PROMPT_CATEGORIES, {
      message: `category must be one of ${PROMPT_CATEGORIES.join(', ')}`,
    }),
  );

export const promptDraft = z.object({
  draftId: draftIdField.optional(),
  text: multiLineText(8, 500),
  category: categorySchema,
});

// A high request-shape ceiling protects parsing even when an administrator has
// no product-level prompt limit.
export const MAX_PROMPTS_PER_REQUEST = 1000;

// What happens to live prompts that the submitted list leaves out.
//
// merge is the historical behavior and stays the default: the draft is a set of
// additions and edits, and nothing already tracked is touched. That default is
// what made a 32-prompt submission leave 35 live, so it is now an explicit
// choice rather than the only one.
export const PROMPT_REMOVE_SEMANTICS = ['merge', 'replace'] as const;
export const promptRemoveSemanticsSchema = z
  .enum(PROMPT_REMOVE_SEMANTICS)
  .default('merge');
export type PromptRemoveSemantics = (typeof PROMPT_REMOVE_SEMANTICS)[number];

// Two entries that resolve to the same prompt text are the same prompt, and
// prompt text is unique per workspace, so a duplicate is a submission error
// rather than something to resolve silently. Reported by index so the caller can
// find it, matching the existing expectedVersion conflict shape.
export const duplicatePromptIndex = (
  prompts: { draftId?: string; text: string }[],
): number | null => {
  const seenText = new Set<string>();
  const seenDraftId = new Set<string>();
  for (const [index, prompt] of prompts.entries()) {
    const key = prompt.text.trim().replace(/\s+/gu, ' ').toLowerCase();
    if (seenText.has(key)) {
      return index;
    }
    seenText.add(key);
    if (prompt.draftId) {
      if (seenDraftId.has(prompt.draftId)) {
        return index;
      }
      seenDraftId.add(prompt.draftId);
    }
  }
  return null;
};

export const patchRequestSchema = z.object({
  expectedVersion: expectedVersionField,
  removeSemantics: promptRemoveSemanticsSchema.optional(),
  step: z.enum(STEPS).optional(),
  description: multiLineText(0, 800).optional(),
  summary: multiLineText(0, 1500).optional(),
  targetMarket: singleLineText(0, 200).optional(),
  logoUrl: z.string().trim().max(400).optional(),
  competitors: z.array(competitorDraft).max(10).optional(),
  prompts: z.array(promptDraft).max(MAX_PROMPTS_PER_REQUEST).optional(),
  surfaces: z.array(z.enum(SURFACES)).min(1).max(SURFACES.length).optional(),
});
export type UpdateDraftInput = z.infer<typeof patchRequestSchema>;

export const commitRequestSchema = z.object({
  expectedVersion: expectedVersionField,
});

export const confirmRequestSchema = z.object({
  expectedVersion: expectedVersionField,
  configurationHash: z.string().regex(/^[0-9a-f]{64}$/),
  idempotencyKey: idempotencyKeyField,
});

export type OnboardingErrorBody =
  | string
  | {
      code: 'draft_version_conflict';
      message: string;
      currentVersion: number;
      heldVersion?: number;
      changedBy?: 'dashboard' | 'mcp';
      state: OnboardingState;
    }
  | {
      code: 'setup_budget_exhausted';
      message: string;
      retryAfterSeconds: number;
    }
  | {
      code: 'duplicate_draft_id';
      message: string;
      duplicates: string[];
    };

// A draftId names one editable entry to the client; two entries sharing one
// id turn every later edit-by-id into a lottery. Absent ids are generated
// server-side, so only explicit repeats are a conflict.
export const duplicateDraftIds = (
  entries: { draftId?: string }[],
): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (entry.draftId === undefined) {
      continue;
    }
    if (seen.has(entry.draftId)) {
      duplicates.add(entry.draftId);
    }
    seen.add(entry.draftId);
  }
  return [...duplicates];
};

export type OnboardingFailure = {
  error: OnboardingErrorBody;
  status: 400 | 404 | 409 | 429;
};

// The resumable wizard state: the committed brand entity + the profile draft
// (description/competitors/prompts) + the completion flag. Competitors and
// prompts stay as drafts until commit materialises them as real rows.
export interface OnboardingState {
  onboardingCompleted: boolean;
  committed: boolean;
  step: OnboardingStep;
  // Optimistic-concurrency version; every mutation echoes the fresh value.
  version: number;
  surfaces: Surface[];
  brand: {
    id: number;
    name: string;
    domains: string[];
    aliases: Alias[];
  } | null;
  profile: {
    description: string;
    summary: string;
    targetMarket: string;
    logoUrl: string;
    siteMetadata: SiteMetadata | null;
    competitors: {
      draftId: string;
      name: string;
      domains: string[];
      aliases: AliasDraft[];
    }[];
    prompts: { draftId: string; text: string; category: string }[];
  };
  regenLimit: number;
  regen: { describe: number; competitors: number; prompts: number };
  // Present only when the caller asks for planning data (the state GETs);
  // mutation echoes stay lean. limits are the caller's effective policy and
  // budget mirrors the setup_usage ledger over the last 24h.
  limits?: {
    isAdmin: boolean;
    maxWorkspaces: number | null;
    maxActivePromptsPerWorkspace: number | null;
    maxEnabledSurfacesPerWorkspace: number;
  };
  budget?: {
    sections: {
      describe: { attempts: number; failures: number };
      competitors: { attempts: number; failures: number };
      prompts: { attempts: number; failures: number };
    };
    generationsUsed24h: number;
    // null = the per-user daily cap does not apply (administrators); the
    // global daily circuit breaker always applies.
    generationsPerDay: number | null;
  };
}
