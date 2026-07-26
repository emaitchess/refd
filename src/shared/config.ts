import { z } from 'zod';
import { SURFACES } from './surfaces';

export const STANDARD_LIMITS = {
  maxWorkspaces: 5,
  maxActivePromptsPerWorkspace: 25,
  maxEnabledSurfacesPerWorkspace: 3,
} as const;

const nullableLimit = z.number().int().positive().nullable();

export const applicationConfigSchema = z.object({
  version: z.literal(1),
  isAdmin: z.boolean(),
  limits: z.object({
    maxWorkspaces: nullableLimit,
    maxActivePromptsPerWorkspace: nullableLimit,
    maxEnabledSurfacesPerWorkspace: z.number().int().positive(),
  }),
  availableSurfaces: z
    .array(z.enum(SURFACES))
    .length(SURFACES.length)
    .refine(
      (surfaces) =>
        surfaces.every((surface, index) => surface === SURFACES[index]),
      'surfaces must use canonical order',
    ),
});

export type ApplicationConfig = z.infer<typeof applicationConfigSchema>;
export type Limit = number | null;

export const applicationConfigFor = (isAdmin: boolean): ApplicationConfig => ({
  version: 1,
  isAdmin,
  limits: isAdmin
    ? {
        maxWorkspaces: null,
        maxActivePromptsPerWorkspace: null,
        maxEnabledSurfacesPerWorkspace: SURFACES.length,
      }
    : { ...STANDARD_LIMITS },
  availableSurfaces: [...SURFACES],
});

export const limitReached = (count: number, limit: Limit): boolean =>
  limit !== null && count >= limit;

export const workspaceLimitMessage = (limit: number): string =>
  `You can have up to ${limit} workspaces. Delete one to create another.`;

export const promptLimitMessage = (limit: number): string =>
  `You can have up to ${limit} active prompts in each workspace. Retire one to add or activate another.`;

export const surfaceLimitMessage = (limit: number): string =>
  `You can enable up to ${limit} AI surfaces in each workspace.`;
