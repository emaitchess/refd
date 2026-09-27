import { PROMPT_KINDS, type PromptKind } from '@refd/core/prompt-cohorts';
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { getDb } from '../db/client';
import {
  citations,
  entities,
  entityScores,
  prompts,
  results,
  runs,
  workspaces,
} from '../db/schema';
import type { AppEnv } from '../env';
import { promptSetTimeline } from '../ingest/prompt-set-versions';
import { answerTextFromRaw } from '../ingest/rescore';
import { promptSetHash } from '../ingest/runs';
import { gunzipJson } from '../ingest/storage';
import {
  countPromptsPerAttribute,
  listAttributes,
  ungroupedPromptCount,
} from '../lib/attributes';
import {
  cohortScopeLabel,
  defaultHeadlineKind,
  populationLabel,
  promptIdsForCohorts,
  promptKindOrDiscovery,
  workspaceCohorts,
} from '../lib/prompt-cohorts';
import { type Range, rangeLabel, rangeWindows } from '../lib/range';
import {
  resolveSurfaceRegistry,
  withSurfaceStatus,
} from '../lib/surface-registry';
import { configForUser } from '../lib/user-config';
import { enabledSurfaces } from '../providers/types';
import { buildChangeReport, populationNote } from '../routes/changes';
import { buildDigest } from '../routes/digest';
import {
  answerCount,
  avgPosition,
  cellRate,
  coverageStats,
  firstMentionShare,
  listEntities,
  loadCoverageRows,
  loadEntitiesWithBrand,
  loadScoreRows,
  pooledSov,
  prominenceDist,
  type ScoreRow,
  sentimentDist,
  shareOf,
} from '../routes/metrics';

const r3 = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 1000) / 1000;

export const getWorkspaceInfo = async (
  env: AppEnv,
  workspaceId: number,
  userEmail: string,
) => {
  const db = getDb(env);
  const [workspace, trackedEntities] = await Promise.all([
    db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        surfaces: workspaces.surfaces,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1),
    listEntities(db, workspaceId),
  ]);
  const current = workspace[0];
  if (!current) {
    return { found: false };
  }
  const maxSurfaces = configForUser(userEmail, env.ADMIN_EMAILS).limits
    .maxEnabledSurfacesPerWorkspace;
  const brand = trackedEntities.find((entity) => entity.isBrand);
  return {
    found: true,
    workspace: { id: current.id, name: current.name },
    brand: brand
      ? { name: brand.name, domains: brand.domains, aliases: brand.aliases }
      : null,
    competitors: trackedEntities
      .filter((entity) => !entity.isBrand)
      .map((entity) => ({
        name: entity.name,
        domains: entity.domains,
        aliases: entity.aliases,
      })),
    enabledSurfaces: enabledSurfaces(current.surfaces, maxSurfaces),
  };
};

export const getVisibilityOverview = async (
  env: AppEnv,
  workspaceId: number,
  range: Range,
  kind: readonly PromptKind[] | null = null,
) => {
  const db = getDb(env);
  const { from } = rangeWindows(range);
  const { entities: trackedEntities, brand } = await loadEntitiesWithBrand(
    db,
    workspaceId,
  );
  if (!brand) {
    return { needsSetup: true as const, range, rangeLabel: rangeLabel(range) };
  }
  // Two populations, computed once: the headline's, and the blended figure kept
  // beside it. The headline is the discovery cohort unless the caller named one
  // or the workspace has no discovery prompts, so the number a caller gets by
  // asking nothing is the defensible one.
  //
  // Both pools are filtered at the SQL seam, so a cohort rate is computed from
  // cohort cells only: cellRate weights each (run, prompt, surface) cell once,
  // which is what makes a filtered rate a rate for that cohort rather than a
  // re-weighted share of the blended one. blendedRows is only fetched when the
  // headline is already unfiltered, so the common path does not double the read.
  const headlineKind = await defaultHeadlineKind(db, workspaceId, kind);
  const headlineCohorts = await workspaceCohorts(db, workspaceId, headlineKind);
  const headlineIds = promptIdsForCohorts(headlineCohorts);
  // The unfiltered pool is always read: the deprecated blended block is a real
  // measurement, not a fallback, and skipping it would ship an empty one. When
  // the headline is already unfiltered the two pools are the same read, so it
  // is done once.
  const unfiltered = () => loadScoreRows(db, workspaceId, from);
  const [rows, blendedRows, coverageRows] = await Promise.all([
    headlineIds === undefined
      ? unfiltered()
      : loadScoreRows(db, workspaceId, from, '9999-99-99', headlineIds),
    unfiltered(),
    loadCoverageRows(db, workspaceId, from),
  ]);
  const hasCompetitors = trackedEntities.some((entity) => !entity.isBrand);
  const mentionSov = hasCompetitors ? pooledSov(rows, 'mentioned') : null;
  const citationSov = hasCompetitors ? pooledSov(rows, 'cited') : null;
  const firstShares = hasCompetitors ? firstMentionShare(rows) : null;
  // One resolved answer to "which surfaces is this over, and which are running",
  // so this response cannot disagree with get_workspace_info about coverage.
  const registry = await resolveSurfaceRegistry(db, workspaceId, { from });
  const surfaces = withSurfaceStatus(
    [...new Set(rows.map((row) => row.surface))].sort().map((surface) => {
      const scope = rows.filter((row) => row.surface === surface);
      return {
        surface,
        mentionRate: r3(cellRate(scope, brand.id, 'mentioned')),
        citationRate: r3(cellRate(scope, brand.id, 'cited')),
        averagePosition: r3(avgPosition(scope, brand.id)),
        answers: answerCount(scope),
      };
    }),
    registry,
  );
  const measures = (
    scope: ScoreRow[],
    sov: Map<number, number> | null,
    cSov: Map<number, number> | null,
    first: Map<number, number> | null,
  ) => ({
    n: answerCount(scope),
    mentionRate: r3(cellRate(scope, brand.id, 'mentioned')),
    citationRate: r3(cellRate(scope, brand.id, 'cited')),
    shareOfVoice: r3(shareOf(sov, brand.id)),
    citationShareOfVoice: r3(shareOf(cSov, brand.id)),
    averagePosition: r3(avgPosition(scope, brand.id)),
    firstNamedShare: r3(shareOf(first, brand.id)),
    prominence: prominenceDist(scope, brand.id),
    sentiment: sentimentDist(scope, brand.id),
  });
  const sovFor = (scope: ScoreRow[]) =>
    hasCompetitors ? pooledSov(scope, 'mentioned') : null;
  const cSovFor = (scope: ScoreRow[]) =>
    hasCompetitors ? pooledSov(scope, 'cited') : null;
  const firstFor = (scope: ScoreRow[]) =>
    hasCompetitors ? firstMentionShare(scope) : null;

  return {
    needsSetup: false as const,
    range,
    rangeLabel: rangeLabel(range),
    brand: brand.name,
    // The headline always names its population, so a number can never be read as
    // organic visibility when it was measured over brand-named questions.
    headline: {
      population: populationLabel(headlineKind),
      scope: cohortScopeLabel(headlineKind),
      ...measures(rows, mentionSov, citationSov, firstShares),
    },
    byCohort: await cohortBreakdown(
      db,
      workspaceId,
      brand,
      from,
      hasCompetitors,
    ),
    // Kept, labelled, and out of the way. Nothing reads it by accident because
    // it is no longer at the top level.
    blended: {
      deprecated: true as const,
      note: 'pools every prompt cohort, so brand-named and competitor-named questions inflate it; read headline for unprompted visibility',
      ...measures(
        blendedRows,
        sovFor(blendedRows),
        cSovFor(blendedRows),
        firstFor(blendedRows),
      ),
    },
    coverage: coverageStats(coverageRows),
    surfaces,
    // The resolved registry, so a caller never has to reconcile this response
    // against get_workspace_info to learn whether a surface is still running.
    surfaceRegistry: registry,
  };
};

// Per-cohort headline for the brand, always over the unfiltered pool so a
// caller can see the whole picture beside whichever cohort they asked for.
const cohortBreakdown = async (
  db: Db,
  workspaceId: number,
  brand: { id: number },
  from: string,
  hasCompetitors: boolean,
) => {
  const cohorts = (await workspaceCohorts(db, workspaceId, PROMPT_KINDS)) ?? [];
  const all = await loadScoreRows(db, workspaceId, from);
  const cohortOf = new Map<number, PromptKind>();
  for (const cohort of cohorts) {
    for (const id of cohort.promptIds) {
      cohortOf.set(id, cohort.kind);
    }
  }
  const breakdown: Record<
    PromptKind,
    {
      prompts: number;
      answers: number | null;
      mentionRate: number | null;
      citationRate: number | null;
      shareOfVoice: number | null;
      citationShareOfVoice: number | null;
    }
  > = {} as never;
  for (const cohort of cohorts) {
    const rows = all.filter(
      (row) => cohortOf.get(row.promptId) === cohort.kind,
    );
    const mentionSov = hasCompetitors ? pooledSov(rows, 'mentioned') : null;
    const citationSov = hasCompetitors ? pooledSov(rows, 'cited') : null;
    breakdown[cohort.kind] = {
      prompts: cohort.prompts,
      answers: answerCount(rows),
      mentionRate: r3(cellRate(rows, brand.id, 'mentioned')),
      citationRate: r3(cellRate(rows, brand.id, 'cited')),
      shareOfVoice: r3(shareOf(mentionSov, brand.id)),
      citationShareOfVoice: r3(shareOf(citationSov, brand.id)),
    };
  }
  return breakdown;
};

export const getCompetitorLandscape = async (
  env: AppEnv,
  workspaceId: number,
  range: Range,
  kind: readonly PromptKind[] | null = null,
) => {
  const db = getDb(env);
  const { from } = rangeWindows(range);
  // Same rule as the overview: the headline is discovery unless the caller
  // named a cohort, because a brand-named prompt is where the brand wins by
  // construction and a comparison over it flatters the brand twice over.
  const headlineKind = await defaultHeadlineKind(db, workspaceId, kind);
  const cohorts = await workspaceCohorts(db, workspaceId, headlineKind);
  const [trackedEntities, rows] = await Promise.all([
    listEntities(db, workspaceId),
    loadScoreRows(
      db,
      workspaceId,
      from,
      '9999-99-99',
      promptIdsForCohorts(cohorts),
    ),
  ]);
  const mentionSov = pooledSov(rows, 'mentioned');
  const citationSov = pooledSov(rows, 'cited');
  const firstShares = firstMentionShare(rows);
  const registry = await resolveSurfaceRegistry(db, workspaceId, { from });
  const surfaceList = withSurfaceStatus(
    [...new Set(rows.map((row) => row.surface))]
      .sort()
      .map((surface) => ({ surface })),
    registry,
  );
  return {
    range,
    rangeLabel: rangeLabel(range),
    // Named so a comparison cannot be read as "over everything we track" when
    // it was measured over the questions that named nobody.
    population: populationLabel(headlineKind),
    surfaceRegistry: registry,
    populationScope: cohortScopeLabel(headlineKind),
    answers: answerCount(rows),
    entities: trackedEntities.map((entity) => ({
      name: entity.name,
      isBrand: entity.isBrand,
      mentionRate: r3(cellRate(rows, entity.id, 'mentioned')),
      citationRate: r3(cellRate(rows, entity.id, 'cited')),
      shareOfVoice: r3(shareOf(mentionSov, entity.id)),
      citationShareOfVoice: r3(shareOf(citationSov, entity.id)),
      averagePosition: r3(avgPosition(rows, entity.id)),
      firstNamedShare: r3(shareOf(firstShares, entity.id)),
      sentiment: sentimentDist(rows, entity.id),
      surfaces: surfaceList.map(({ surface, status }) => {
        const scope = rows.filter((row) => row.surface === surface);
        return {
          surface,
          status,
          mentionRate: r3(cellRate(scope, entity.id, 'mentioned')),
          citationRate: r3(cellRate(scope, entity.id, 'cited')),
        };
      }),
    })),
  };
};

export const getPromptPerformance = async (
  env: AppEnv,
  workspaceId: number,
  range: Range,
  summary = false,
  kind: readonly PromptKind[] | null = null,
) => {
  const db = getDb(env);
  const { from } = rangeWindows(range);
  const { brand } = await loadEntitiesWithBrand(db, workspaceId);
  if (!brand) {
    return { needsSetup: true as const, range, rangeLabel: rangeLabel(range) };
  }
  const cohorts = await workspaceCohorts(db, workspaceId, kind);
  const cohortIds =
    cohorts === null ? null : new Set(promptIdsForCohorts(cohorts) ?? []);
  const [allPrompts, scoreRows] = await Promise.all([
    db
      .select({
        id: prompts.id,
        text: prompts.text,
        tags: prompts.tags,
        kind: prompts.kind,
        active: prompts.active,
      })
      .from(prompts)
      .where(eq(prompts.workspaceId, workspaceId))
      .orderBy(prompts.id),
    loadScoreRows(
      db,
      workspaceId,
      from,
      '9999-99-99',
      promptIdsForCohorts(cohorts),
    ),
  ]);
  // The prompt list is small enough to filter in JS, and doing it through the
  // cohort ids keeps one resolution path: a prompt the filter excluded cannot
  // reach the list, the per-surface split, or zeroVisibility.
  const trackedPrompts =
    cohortIds === null
      ? allPrompts
      : allPrompts.filter((prompt) => cohortIds.has(prompt.id));
  const brandRows = scoreRows.filter((row) => row.entityId === brand.id);
  // Bound the one list that summary=true did not bound. An earlier read of a
  // 30-prompt workspace returned every zero-visibility prompt in full, which is
  // the response a caller asked to keep small. The full population is still
  // reachable, so the cap never hides a prompt, it names the cap.
  const performance = trackedPrompts.map((prompt) => {
    const rows = brandRows.filter((row) => row.promptId === prompt.id);
    const mentionRate = r3(cellRate(rows, brand.id, 'mentioned'));
    return {
      id: prompt.id,
      text: prompt.text,
      tags: prompt.tags,
      kind: promptKindOrDiscovery(prompt.kind),
      active: prompt.active,
      answers: answerCount(rows),
      mentionRate,
      citationRate: r3(cellRate(rows, brand.id, 'cited')),
      sentiment: sentimentDist(rows, brand.id),
      // summary=true skips the per-surface breakdown: with 30+ prompts the
      // full response outruns what an audit needs, and the headline numbers
      // live above regardless.
      ...(summary
        ? {}
        : {
            surfaces: [...new Set(rows.map((row) => row.surface))]
              .sort()
              .map((surface) => {
                const scope = rows.filter((row) => row.surface === surface);
                return {
                  surface,
                  mentionRate: r3(cellRate(scope, brand.id, 'mentioned')),
                  citationRate: r3(cellRate(scope, brand.id, 'cited')),
                  answers: answerCount(scope),
                };
              }),
          }),
    };
  });
  // summary=true caps this at a readable page; the default returns the whole
  // list, because a caller that asked for per-surface detail is walking the set
  // rather than reading a summary of it.
  const limit = summary ? 10 : 200;
  const zeroVisibility = performance
    .filter((prompt) => prompt.answers > 0 && prompt.mentionRate === 0)
    .map((prompt) => ({ id: prompt.id, text: prompt.text, kind: prompt.kind }));
  return {
    needsSetup: false as const,
    range,
    rangeLabel: rangeLabel(range),
    brand: brand.name,
    kind,
    headlineScope: cohortScopeLabel(kind),
    prompts: performance,
    // The full list, and a bounded view of it. `count` is always the true
    // population, so a caller that reads only the count is never misled, and
    // `truncated` is true whenever `prompts` is a subset.
    zeroVisibility: {
      count: zeroVisibility.length,
      prompts: zeroVisibility.slice(0, limit),
      truncated: zeroVisibility.length > limit,
    },
  };
};

export const getCitationSources = async (
  env: AppEnv,
  workspaceId: number,
  range: Range,
  kind: readonly PromptKind[] | null = null,
) => {
  const db = getDb(env);
  const { from } = rangeWindows(range);
  const { brand } = await loadEntitiesWithBrand(db, workspaceId);
  if (!brand) {
    return { needsSetup: true as const, range, rangeLabel: rangeLabel(range) };
  }
  const cohortIds =
    kind === null ? null : await workspaceCohorts(db, workspaceId, kind);
  const promptIds = promptIdsForCohorts(cohortIds);
  // A filter that matched no prompt is a real answer of zero, not a licence to
  // report the unfiltered set. Handled here rather than as an empty IN () list,
  // which is not portable across the D1 driver.
  if (promptIds && promptIds.length === 0) {
    return {
      needsSetup: false as const,
      range,
      rangeLabel: rangeLabel(range),
      brand: brand.name,
      headlineScope: cohortScopeLabel(kind),
      domains: [],
      unattributableCitations: 0,
      brandUrls: [],
      sourceGap: [],
    };
  }
  const inRange = and(
    eq(results.ok, true),
    gte(runs.date, from),
    eq(runs.workspaceId, workspaceId),
    ...(promptIds ? [inArray(results.promptId, promptIds)] : []),
  );
  const [domains, unattributable, ourUrls, gap] = await Promise.all([
    db
      .select({
        domain: citations.registrableDomain,
        isOurs: sql<number>`max(case when ${citations.entityId} = ${brand.id} then 1 else 0 end)`,
        citationCount: sql<number>`count(*)`,
        answersCiting: sql<number>`count(distinct ${citations.resultId})`,
      })
      .from(citations)
      .innerJoin(results, eq(citations.resultId, results.id))
      .innerJoin(runs, eq(results.runId, runs.id))
      .where(and(inRange, isNotNull(citations.registrableDomain)))
      .groupBy(citations.registrableDomain)
      .orderBy(sql`count(distinct ${citations.resultId}) desc`)
      .limit(100),
    db
      .select({ citationCount: sql<number>`count(*)` })
      .from(citations)
      .innerJoin(results, eq(citations.resultId, results.id))
      .innerJoin(runs, eq(results.runId, runs.id))
      .where(and(inRange, sql`${citations.registrableDomain} is null`)),
    db
      .select({ url: citations.url, count: sql<number>`count(*)` })
      .from(citations)
      .innerJoin(results, eq(citations.resultId, results.id))
      .innerJoin(runs, eq(results.runId, runs.id))
      .where(and(inRange, eq(citations.entityId, brand.id)))
      .groupBy(citations.url)
      .orderBy(sql`count(*) desc`)
      .limit(100),
    db
      .select({
        domain: citations.registrableDomain,
        answersCiting: sql<number>`count(distinct ${citations.resultId})`,
      })
      .from(citations)
      .innerJoin(results, eq(citations.resultId, results.id))
      .innerJoin(runs, eq(results.runId, runs.id))
      .innerJoin(
        entityScores,
        and(
          eq(entityScores.resultId, results.id),
          eq(entityScores.entityId, brand.id),
        ),
      )
      .where(
        and(
          inRange,
          isNotNull(citations.registrableDomain),
          or(
            sql`${citations.entityId} is null`,
            sql`${citations.entityId} != ${brand.id}`,
          ),
          eq(entityScores.mentioned, false),
          eq(entityScores.cited, false),
        ),
      )
      .groupBy(citations.registrableDomain)
      .orderBy(sql`count(distinct ${citations.resultId}) desc`)
      .limit(50),
  ]);
  return {
    needsSetup: false,
    range,
    rangeLabel: rangeLabel(range),
    brand: brand.name,
    headlineScope: cohortScopeLabel(kind),
    domains: domains.map((domain) => ({
      domain: domain.domain ?? '',
      isOurs: domain.isOurs === 1,
      citations: domain.citationCount,
      answersCiting: domain.answersCiting,
    })),
    unattributableCitations: unattributable[0]?.citationCount ?? 0,
    brandUrls: ourUrls,
    sourceGap: gap.map((domain) => ({
      domain: domain.domain ?? '',
      answersCiting: domain.answersCiting,
    })),
  };
};

const promptMatches = (
  trackedPrompts: {
    id: number;
    text: string;
    tags: string[];
    active: boolean;
  }[],
  rawQuery: string,
) => {
  const query = rawQuery.toLocaleLowerCase();
  let matches = trackedPrompts.filter((prompt) =>
    prompt.text.toLocaleLowerCase().includes(query),
  );
  if (matches.length > 0) {
    return matches.slice(0, 3);
  }
  const tokens = query.split(/[^a-z0-9]+/).filter((token) => token.length > 3);
  matches = trackedPrompts
    .map((prompt) => ({
      prompt,
      score: tokens.filter((token) =>
        prompt.text.toLocaleLowerCase().includes(token),
      ).length,
    }))
    .filter(
      (candidate) =>
        candidate.score >= Math.max(2, Math.ceil(tokens.length / 2)),
    )
    .sort((left, right) => right.score - left.score)
    .map((candidate) => candidate.prompt);
  return matches.slice(0, 3);
};

export const findPromptResults = async (
  env: AppEnv,
  workspaceId: number,
  query: string,
) => {
  const db = getDb(env);
  const trackedPrompts = await db
    .select({
      id: prompts.id,
      text: prompts.text,
      tags: prompts.tags,
      active: prompts.active,
    })
    .from(prompts)
    .where(eq(prompts.workspaceId, workspaceId))
    .limit(500);
  const matches = promptMatches(trackedPrompts, query);
  const match = matches[0];
  if (!match) {
    return { found: false, query, suggestions: [] };
  }
  const latestRun = (
    await db
      .select({ id: runs.id, date: runs.date })
      .from(runs)
      .innerJoin(results, eq(results.runId, runs.id))
      .where(
        and(eq(runs.workspaceId, workspaceId), eq(results.promptId, match.id)),
      )
      .orderBy(desc(runs.id))
      .limit(1)
  )[0];
  if (!latestRun) {
    return {
      found: true,
      prompt: match,
      run: null,
      results: [],
      otherMatches: matches.slice(1).map((prompt) => prompt.text),
    };
  }
  const resultRows = await db
    .select({
      resultId: results.id,
      surface: results.surface,
      sample: results.sample,
      ok: results.ok,
      answerPresent: results.answerPresent,
      hasStoredAnswer: sql<boolean>`${results.r2Key} is not null`,
    })
    .from(results)
    .where(
      and(eq(results.runId, latestRun.id), eq(results.promptId, match.id)),
    );
  const signals =
    resultRows.length === 0
      ? []
      : await db
          .select({
            resultId: entityScores.resultId,
            entity: entities.name,
            mentioned: entityScores.mentioned,
            cited: entityScores.cited,
            position: entityScores.position,
            sentiment: entityScores.sentiment,
          })
          .from(entityScores)
          .innerJoin(entities, eq(entityScores.entityId, entities.id))
          .where(
            sql`${entityScores.resultId} in (${sql.join(
              resultRows.map((row) => sql`${row.resultId}`),
              sql`, `,
            )})`,
          );
  return {
    found: true,
    prompt: match,
    run: latestRun,
    results: resultRows.map((result) => ({
      ...result,
      entities: signals
        .filter(
          (signal) =>
            signal.resultId === result.resultId &&
            (signal.mentioned || signal.cited),
        )
        .map(({ resultId: _resultId, ...signal }) => signal),
    })),
    otherMatches: matches.slice(1).map((prompt) => prompt.text),
  };
};

const ANSWER_CHARS = 2500;

export const readAnswer = async (
  env: AppEnv,
  workspaceId: number,
  resultId: number,
) => {
  const db = getDb(env);
  const row = (
    await db
      .select({
        id: results.id,
        provider: results.provider,
        surface: results.surface,
        r2Key: results.r2Key,
      })
      .from(results)
      .innerJoin(runs, eq(results.runId, runs.id))
      .where(and(eq(results.id, resultId), eq(runs.workspaceId, workspaceId)))
      .limit(1)
  )[0];
  if (!row) {
    return { found: false, resultId };
  }
  if (!row.r2Key) {
    return {
      found: true,
      resultId: row.id,
      surface: row.surface,
      answerAvailable: false,
    };
  }
  const object = await env.RAW.get(row.r2Key);
  if (!object?.body) {
    return {
      found: true,
      resultId: row.id,
      surface: row.surface,
      answerAvailable: false,
    };
  }
  const text = answerTextFromRaw(row.provider, await gunzipJson(object.body));
  if (!text) {
    return {
      found: true,
      resultId: row.id,
      surface: row.surface,
      answerAvailable: false,
    };
  }
  const truncated = text.length > ANSWER_CHARS;
  return {
    found: true,
    resultId: row.id,
    surface: row.surface,
    answerAvailable: true,
    answerText: truncated ? text.slice(0, ANSWER_CHARS) : text,
    truncated,
    untrustedThirdPartyContent: true,
  };
};

export const getRecentChanges = async (env: AppEnv, workspaceId: number) => {
  const report = await buildChangeReport(getDb(env), workspaceId);
  if (report === null) {
    return { needsSetup: true as const };
  }
  // promptCount is the population the events were measured on; activePromptCount
  // is what is tracked now. Reporting only the first is what made a stale
  // population look authoritative.
  return {
    ...report,
    populationNote: populationNote(report),
  };
};

export const getDigest = async (
  env: AppEnv,
  workspaceId: number,
  range: Range,
) => {
  // Deliberately takes no cohort filter. The digest is a whole-workspace
  // rollup: buildDigest has no kind seam, so accepting one here would relabel
  // a blended number as cohort-specific while leaving it blended. A caller that
  // wants one cohort reads sections.prompts.cohorts instead, which this returns
  // unfiltered either way.
  const digest = await buildDigest(getDb(env), workspaceId, range);
  if (digest === null) {
    return { needsSetup: true as const, range, rangeLabel: rangeLabel(range) };
  }
  return { ...digest, headlineScope: cohortScopeLabel(null) };
};

// The workspace's measurement history: every distinct prompt population it has
// run against, what changed to get there, and how much was collected on each.
// Per-attribute visibility: the read that justifies the dimension.
//
// The point is the denominator. One prompt per attribute reports the wording's
// score, not the capability's, so an attribute with a single variant is labelled
// unmeasured rather than reported as a finding.
export const getAttributePerformance = async (
  env: AppEnv,
  workspaceId: number,
  range: Range,
  kind: readonly PromptKind[] | null = null,
) => {
  const db = getDb(env);
  const { from } = rangeWindows(range);
  const { brand } = await loadEntitiesWithBrand(db, workspaceId);
  if (!brand) {
    return { needsSetup: true as const, range, rangeLabel: rangeLabel(range) };
  }
  const headlineKind = await defaultHeadlineKind(db, workspaceId, kind);
  const cohorts = await workspaceCohorts(db, workspaceId, headlineKind);
  const promptIds = promptIdsForCohorts(cohorts);
  const [tracked, allRows, counts, ungrouped, promptAttribute] =
    await Promise.all([
      listAttributes(db, workspaceId),
      loadScoreRows(db, workspaceId, from, '9999-99-99', promptIds),
      countPromptsPerAttribute(db, workspaceId),
      ungroupedPromptCount(db, workspaceId),
      db
        .select({ id: prompts.id, attributeId: prompts.attributeId })
        .from(prompts)
        .where(eq(prompts.workspaceId, workspaceId)),
    ]);

  const perAttribute = tracked.map((attribute) => {
    const memberIds = new Set(
      promptAttribute
        .filter((row) => row.attributeId === attribute.id)
        .map((row) => row.id),
    );
    const rows = allRows.filter((row) => memberIds.has(row.promptId));
    const variants = counts.get(attribute.id) ?? 0;
    return {
      id: attribute.id,
      label: attribute.label,
      description: attribute.description,
      // Membership is what the attribute is, so it counts every tracked prompt
      // carrying it. measuredPrompts is how many of those fall inside the
      // reported population, which is what makes a cohort filter legible: the
      // two differing is the filter doing its job, not a prompt going missing.
      prompts: memberIds.size,
      measuredPrompts: new Set(rows.map((r) => r.promptId)).size,
      variants,
      measured: rows.length > 0,
      variantWarning:
        variants === 1 && rows.length > 0
          ? 'unmeasured: one prompt cannot separate this capability from its wording'
          : null,
      answers: answerCount(rows),
      mentionRate: r3(cellRate(rows, brand.id, 'mentioned')),
      citationRate: r3(cellRate(rows, brand.id, 'cited')),
      shareOfVoice: r3(shareOf(pooledSov(rows, 'mentioned'), brand.id)),
    };
  });

  return {
    needsSetup: false as const,
    range,
    rangeLabel: rangeLabel(range),
    population: populationLabel(headlineKind),
    populationScope: cohortScopeLabel(headlineKind),
    // Worst first: an attribute scoring zero is what a reader came for, not the
    // one already scoring best.
    attributes: perAttribute.sort(
      (a, b) => (a.mentionRate ?? -1) - (b.mentionRate ?? -1),
    ),
    ungrouped: {
      prompts: ungrouped,
      note: 'tracked prompts carrying no attribute',
    },
    note: 'A single prompt per attribute measures its wording, not the capability. An attribute needs at least two differently-worded prompts before its rate is a finding.',
  };
};

export const getPromptSetTimeline = async (
  env: AppEnv,
  workspaceId: number,
) => {
  const versions = await promptSetTimeline(getDb(env), workspaceId);
  return {
    versions,
    note: 'A direct comparison between two dates is only meaningful when both fall in the same version. Across versions the questions changed, so compare by kind filter or read each version on its own.',
  };
};

export const getRunHistory = async (
  env: AppEnv,
  workspaceId: number,
  limit = 10,
) => {
  const rows = await getDb(env)
    .select({
      id: runs.id,
      key: runs.key,
      date: runs.date,
      trigger: runs.trigger,
      status: runs.status,
      okCount: runs.okCount,
      totalCount: runs.totalCount,
      dispatchState: runs.dispatchState,
      entitySetHash: runs.entitySetHash,
      promptCount: sql<
        number | null
      >`json_array_length(${runs.dispatchPlan}, '$.prompts')`,
      dispatchPlan: runs.dispatchPlan,
      // The population this run measured. Two runs with the same version id were
      // measured against the same questions, which is the precondition for
      // reading their numbers as a trend rather than two separate facts.
      promptSetVersionId: runs.promptSetVersionId,
      createdAt: runs.createdAt,
      completedAt: runs.completedAt,
    })
    .from(runs)
    .where(eq(runs.workspaceId, workspaceId))
    .orderBy(desc(runs.id))
    .limit(Math.max(1, Math.min(limit, 50)));
  return {
    runs: rows.map((row) => {
      const { dispatchPlan, ...rest } = row;
      return {
        ...rest,
        promptCount: row.promptCount === null ? null : Number(row.promptCount),
        // The population identity for this run, so a reader can group runs by
        // the question set they measured instead of inferring it from dates.
        promptSetHash: promptSetHash(dispatchPlan),
      };
    }),
  };
};

// Per-prompt diff between the two most recent completed runs. Single-run
// deltas carry answer non-determinism (the changes engine compares 7-day
// windows for exactly that reason), so the response says so — but the prompt
// granularity here is what a changed prompt set needs to be navigable.
export interface PromptDiffRow {
  promptId: number;
  text: string;
  previous: {
    answers: number;
    mentionRate: number | null;
    citationRate: number | null;
    zeroVisibility: boolean;
  };
  current: {
    answers: number;
    mentionRate: number | null;
    citationRate: number | null;
    zeroVisibility: boolean;
  };
  mentionDelta: number | null;
  citationDelta: number | null;
  transition: 'entered-zero' | 'exited-zero' | null;
}

export const getPromptRunDiff = async (env: AppEnv, workspaceId: number) => {
  const db = getDb(env);
  const { brand } = await loadEntitiesWithBrand(db, workspaceId);
  if (!brand) {
    return { needsSetup: true };
  }
  const pair = await db
    .select({
      id: runs.id,
      key: runs.key,
      date: runs.date,
      trigger: runs.trigger,
      entitySetHash: runs.entitySetHash,
    })
    .from(runs)
    .where(and(eq(runs.workspaceId, workspaceId), eq(runs.status, 'complete')))
    .orderBy(desc(runs.id))
    .limit(2);
  const emptyRows: PromptDiffRow[] = [];
  if (pair.length < 2) {
    return {
      status: 'needs-runs' as const,
      latestRun: pair[0] ?? null,
      previousRun: null,
      prompts: emptyRows,
      entered: [] as { promptId: number; text: string }[],
      exited: [] as { promptId: number; text: string }[],
    };
  }
  const latest = pair[0];
  const previous = pair[1];
  if (!latest || !previous) {
    return {
      status: 'needs-runs' as const,
      latestRun: null,
      previousRun: null,
      prompts: emptyRows,
      entered: [],
      exited: [],
    };
  }
  const [rows, promptRows] = await Promise.all([
    loadScoreRows(db, workspaceId, previous.date),
    db
      .select({ id: prompts.id, text: prompts.text })
      .from(prompts)
      .where(eq(prompts.workspaceId, workspaceId)),
  ]);
  const texts = new Map(promptRows.map((row) => [row.id, row.text]));
  const scoped = rows.filter(
    (row) =>
      row.entityId === brand.id &&
      (row.runId === latest.id || row.runId === previous.id),
  );
  const aggregate = (runId: number) => {
    const byPrompt = new Map<
      number,
      { answers: number; mentioned: number; cited: number }
    >();
    for (const row of scoped) {
      if (row.runId !== runId) {
        continue;
      }
      const cell = byPrompt.get(row.promptId) ?? {
        answers: 0,
        mentioned: 0,
        cited: 0,
      };
      cell.answers += 1;
      if (row.mentioned) {
        cell.mentioned += 1;
      }
      if (row.cited) {
        cell.cited += 1;
      }
      byPrompt.set(row.promptId, cell);
    }
    return byPrompt;
  };
  const current = aggregate(latest.id);
  const prior = aggregate(previous.id);
  const metrics = (cell: {
    answers: number;
    mentioned: number;
    cited: number;
  }): {
    answers: number;
    mentionRate: number;
    citationRate: number;
    zeroVisibility: boolean;
  } => {
    const mentionRate = cell.answers > 0 ? cell.mentioned / cell.answers : 0;
    const citationRate = cell.answers > 0 ? cell.cited / cell.answers : 0;
    return {
      answers: cell.answers,
      mentionRate,
      citationRate,
      // Zero visibility is a real state, not absence: answers were collected
      // and the brand simply never appeared.
      zeroVisibility: cell.answers > 0 && mentionRate === 0,
    };
  };
  const diffs: PromptDiffRow[] = [];
  const entered: { promptId: number; text: string }[] = [];
  const exited: { promptId: number; text: string }[] = [];
  for (const promptId of new Set([...current.keys(), ...prior.keys()])) {
    const text = texts.get(promptId) ?? '';
    const cur = current.get(promptId);
    const prev = prior.get(promptId);
    if (!cur) {
      exited.push({ promptId, text });
      continue;
    }
    if (!prev) {
      entered.push({ promptId, text });
      continue;
    }
    const previousMetrics = metrics(prev);
    const currentMetrics = metrics(cur);
    diffs.push({
      promptId,
      text,
      previous: {
        ...previousMetrics,
        mentionRate: r3(previousMetrics.mentionRate),
        citationRate: r3(previousMetrics.citationRate),
      },
      current: {
        ...currentMetrics,
        mentionRate: r3(currentMetrics.mentionRate),
        citationRate: r3(currentMetrics.citationRate),
      },
      mentionDelta: r3(
        currentMetrics.mentionRate - previousMetrics.mentionRate,
      ),
      citationDelta: r3(
        currentMetrics.citationRate - previousMetrics.citationRate,
      ),
      transition:
        currentMetrics.zeroVisibility !== previousMetrics.zeroVisibility
          ? currentMetrics.zeroVisibility
            ? 'entered-zero'
            : 'exited-zero'
          : null,
    });
  }
  diffs.sort(
    (a, b) =>
      (a as { promptId: number }).promptId -
      (b as { promptId: number }).promptId,
  );
  return {
    status: 'ok' as const,
    latestRun: {
      id: latest.id,
      key: latest.key,
      date: latest.date,
      trigger: latest.trigger,
    },
    previousRun: {
      id: previous.id,
      key: previous.key,
      date: previous.date,
      trigger: previous.trigger,
    },
    entitySetChanged: latest.entitySetHash !== previous.entitySetHash,
    note: 'Single-run deltas include answer non-determinism; a rate swing within a few points is noise. get_recent_changes compares seven-day windows for that reason.',
    sharedPrompts: diffs.length,
    prompts: diffs,
    entered,
    exited,
  };
};

export const getPromptCitations = async (
  env: AppEnv,
  workspaceId: number,
  promptId: number,
  range: Range,
) => {
  const db = getDb(env);
  const { brand } = await loadEntitiesWithBrand(db, workspaceId);
  if (!brand) {
    return { needsSetup: true as const, range, rangeLabel: rangeLabel(range) };
  }
  const prompt = (
    await db
      .select({ id: prompts.id, text: prompts.text, active: prompts.active })
      .from(prompts)
      .where(
        and(eq(prompts.id, promptId), eq(prompts.workspaceId, workspaceId)),
      )
      .limit(1)
  )[0];
  if (!prompt) {
    return { found: false, promptId };
  }
  const { from } = rangeWindows(range);
  const [urls, totals] = await Promise.all([
    db
      .select({
        url: citations.url,
        domain: citations.registrableDomain,
        isOurs: sql<number>`max(case when ${citations.entityId} = ${brand.id} then 1 else 0 end)`,
        citations: sql<number>`count(*)`,
        answers: sql<number>`count(distinct ${citations.resultId})`,
      })
      .from(citations)
      .innerJoin(results, eq(citations.resultId, results.id))
      .innerJoin(runs, eq(results.runId, runs.id))
      .where(
        and(
          eq(runs.workspaceId, workspaceId),
          eq(results.promptId, promptId),
          gte(runs.date, from),
        ),
      )
      .groupBy(citations.url)
      .orderBy(sql`count(*) desc`)
      .limit(100),
    db
      .select({ citations: sql<number>`count(*)` })
      .from(citations)
      .innerJoin(results, eq(citations.resultId, results.id))
      .innerJoin(runs, eq(results.runId, runs.id))
      .where(
        and(
          eq(runs.workspaceId, workspaceId),
          eq(results.promptId, promptId),
          gte(runs.date, from),
        ),
      ),
  ]);
  return {
    found: true,
    prompt,
    range,
    rangeLabel: rangeLabel(range),
    brand: brand.name,
    citationCount: Number(totals[0]?.citations ?? 0),
    urls: urls.map((row) => ({
      url: row.url,
      domain: row.domain ?? '',
      isOurs: row.isOurs === 1,
      citations: Number(row.citations),
      answers: Number(row.answers),
    })),
  };
};
