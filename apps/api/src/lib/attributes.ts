// Attribute grouping: many prompts to one capability, so a set can be read at
// the level the capability varies at rather than at the level the wording varies
// at.
//
// An attribute is addressed by label, not id, everywhere a caller supplies one.
// Ids are assigned here, and prompt text is already the unique identity in a
// prompt submission, so a label-keyed API is one less thing for a caller to
// round-trip through a draft.

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { attributes, prompts } from '../db/schema';

export const attributeLabel = z
  .string()
  .transform((value) => value.trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(2).max(80));

export interface AttributeInfo {
  id: number;
  label: string;
  description: string | null;
  sortOrder: number;
}

export const listAttributes = async (
  db: Db,
  workspaceId: number,
): Promise<AttributeInfo[]> => {
  const rows = await db
    .select({
      id: attributes.id,
      label: attributes.label,
      description: attributes.description,
      sortOrder: attributes.sortOrder,
    })
    .from(attributes)
    .where(eq(attributes.workspaceId, workspaceId))
    .orderBy(asc(attributes.sortOrder), asc(attributes.id));
  return rows;
};

// Case-insensitive on the folded label, matching how prompt text is compared
// elsewhere, so "File management" and "file  management" are the same attribute.
export const findAttributeByLabel = async (
  db: Db,
  workspaceId: number,
  label: string,
): Promise<AttributeInfo | null> => {
  const [row] = await db
    .select({
      id: attributes.id,
      label: attributes.label,
      description: attributes.description,
      sortOrder: attributes.sortOrder,
    })
    .from(attributes)
    .where(
      and(
        eq(attributes.workspaceId, workspaceId),
        sql`lower(${attributes.label}) = lower(${label})`,
      ),
    )
    .limit(1);
  return row ?? null;
};

// Returns null for a null input, so "leave it alone" and "not grouped" are
// distinct: a caller that omits the field never clears an existing attribute,
// while an explicit null does.
export const resolveAttributeId = async (
  db: Db,
  workspaceId: number,
  label: string | null | undefined,
): Promise<number | null | undefined> => {
  if (label === undefined) {
    return undefined;
  }
  if (label === null) {
    return null;
  }
  const parsed = attributeLabel.safeParse(label);
  if (!parsed.success) {
    throw new Error(`invalid attribute label: ${label}`);
  }
  const existing = await findAttributeByLabel(db, workspaceId, parsed.data);
  if (existing) {
    return existing.id;
  }
  const [next] = await db
    .select({ n: sql<number>`coalesce(max(${attributes.sortOrder}), -1) + 1` })
    .from(attributes)
    .where(eq(attributes.workspaceId, workspaceId));
  const inserted = (
    await db
      .insert(attributes)
      .values({ workspaceId, label: parsed.data, sortOrder: next?.n ?? 0 })
      .returning({ id: attributes.id })
  )[0];
  return inserted?.id ?? null;
};

export const countPromptsPerAttribute = async (
  db: Db,
  workspaceId: number,
): Promise<Map<number, number>> => {
  const rows = await db
    .select({
      attributeId: prompts.attributeId,
      n: sql<number>`count(*)`,
    })
    .from(prompts)
    .where(
      and(
        eq(prompts.workspaceId, workspaceId),
        eq(prompts.active, true),
        sql`${prompts.attributeId} is not null`,
      ),
    )
    .groupBy(prompts.attributeId);
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.attributeId !== null) {
      counts.set(row.attributeId, Number(row.n));
    }
  }
  return counts;
};

export const ungroupedPromptCount = async (
  db: Db,
  workspaceId: number,
): Promise<number> => {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(prompts)
    .where(
      and(
        eq(prompts.workspaceId, workspaceId),
        eq(prompts.active, true),
        isNull(prompts.attributeId),
      ),
    );
  return row?.n ?? 0;
};
