import type { Alias } from '@refd/core/mentions';
import type { SiteMetadata } from '@refd/core/site-metadata';
import { z } from 'zod';
import { domainField, multiLineText, singleLineText } from '../lib/sanitize';
import type { Surface } from '../providers/types';

export const STEPS = [
  'brand',
  'describe',
  'competitors',
  'prompts',
  'report',
] as const;

export type OnboardingStep = (typeof STEPS)[number];

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

export const generationRequestSchema = regenBody.extend({
  expectedVersion: expectedVersionField,
  idempotencyKey: z.string().uuid().optional(),
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

export const promptDraft = z.object({
  draftId: draftIdField.optional(),
  text: multiLineText(8, 500),
  category: singleLineText(1, 40),
});

// A high request-shape ceiling protects parsing even when an administrator has
// no product-level prompt limit.
export const MAX_PROMPTS_PER_REQUEST = 1000;

export const patchRequestSchema = z.object({
  expectedVersion: expectedVersionField,
  step: z.enum(STEPS).optional(),
  description: multiLineText(0, 800).optional(),
  summary: multiLineText(0, 1500).optional(),
  targetMarket: singleLineText(0, 200).optional(),
  logoUrl: z.string().trim().max(400).optional(),
  competitors: z.array(competitorDraft).max(10).optional(),
  prompts: z.array(promptDraft).max(MAX_PROMPTS_PER_REQUEST).optional(),
});
export type UpdateDraftInput = z.infer<typeof patchRequestSchema>;

export const commitRequestSchema = z.object({
  expectedVersion: expectedVersionField,
});

export const confirmRequestSchema = z.object({
  expectedVersion: expectedVersionField,
  configurationHash: z.string().regex(/^[0-9a-f]{64}$/),
  idempotencyKey: z.string().uuid(),
});

export type OnboardingErrorBody =
  | string
  | {
      code: 'draft_version_conflict';
      message: string;
      currentVersion: number;
      state: OnboardingState;
    }
  | {
      code: 'setup_budget_exhausted';
      message: string;
      retryAfterSeconds: number;
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
}
