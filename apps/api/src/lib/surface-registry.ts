// One resolved answer to "which surfaces is this measured over, and which of
// them is the workspace actually running?".
//
// The disagreement this fixes: get_workspace_info reported the configured set
// while get_visibility_overview and get_competitor_landscape reported the set
// derived from score rows in the window. A surface disabled after the window
// opened still has data in it, so it appeared in the analytics with no label,
// and a user reconciling denominators had no way to tell a running surface from
// a departed one. Worse, coverage figures for a surface that is no longer
// enabled cannot be interpreted at all, because nothing said so.
//
// A surface is therefore never silently present or silently absent: it is
// present with a status, and the status travels with the per-surface numbers.

import type { Surface } from '@refd/core/surfaces';
import { SURFACE_ORDER } from '@refd/core/surfaces';
import { and, eq, gte, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { results, runs, workspaces } from '../db/schema';
import { enabledSurfaces } from '../providers/types';

export type SurfaceStatus = 'enabled' | 'historical';

export interface ResolvedSurface {
  surface: string;
  status: SurfaceStatus;
}

export interface SurfaceRegistry {
  // Every surface any response should account for: the configured set plus any
  // surface carrying data in the window, ordered canonically.
  surfaces: ResolvedSurface[];
  enabled: string[];
  // Carries data in the window but is not currently enabled. Its figures are
  // real and belong to a period when it was running, which is exactly why they
  // must not be mixed into a current-period total without saying so.
  historical: string[];
  note: string;
}

export const resolveSurfaceRegistry = async (
  db: Db,
  workspaceId: number,
  opts: { from?: string; to?: string; maxSurfaces?: number } = {},
): Promise<SurfaceRegistry> => {
  const [row] = await db
    .select({ surfaces: workspaces.surfaces })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const enabled = enabledSurfaces(
    row?.surfaces,
    opts.maxSurfaces ?? SURFACE_ORDER.length,
  );
  const enabledSet = new Set<string>(enabled);

  // Surfaces that actually produced results in the window, which is a different
  // question from which are configured.
  const conditions = [eq(runs.workspaceId, workspaceId)];
  if (opts.from !== undefined) {
    conditions.push(gte(runs.date, opts.from));
  }
  if (opts.to !== undefined) {
    conditions.push(lt(runs.date, opts.to));
  }
  const measured = await db
    .selectDistinct({ surface: results.surface })
    .from(results)
    .innerJoin(runs, eq(results.runId, runs.id))
    .where(and(...conditions));

  const withData = new Set(measured.map((r) => r.surface));
  const union = new Set<string>([...enabledSet, ...withData]);
  const surfaces = SURFACE_ORDER.filter((s) => union.has(s)).map((surface) => ({
    surface,
    status: (enabledSet.has(surface)
      ? 'enabled'
      : 'historical') as SurfaceStatus,
  }));

  const historical = surfaces
    .filter((s) => s.status === 'historical')
    .map((s) => s.surface);
  return {
    surfaces,
    enabled: [...enabledSet],
    historical,
    note:
      historical.length === 0
        ? 'every surface with data in this window is currently enabled'
        : `${historical.join(', ')} carry data in this window but are not currently enabled: their figures belong to a period when they were running, and are excluded from any current-period denominator`,
  };
};

// Attaches a status to a per-surface figure so the number and its provenance
// cannot be read apart.
export const withSurfaceStatus = <T extends { surface: string }>(
  items: T[],
  registry: SurfaceRegistry,
): (T & { status: SurfaceStatus })[] => {
  const status = new Map(registry.surfaces.map((s) => [s.surface, s.status]));
  return items.map((item) => ({
    ...item,
    status: status.get(item.surface) ?? 'historical',
  }));
};

export const enabledSurfaceNames = (registry: SurfaceRegistry): Surface[] =>
  registry.enabled as Surface[];
