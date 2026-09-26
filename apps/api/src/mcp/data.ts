import { and, desc, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
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
import { answerTextFromRaw } from '../ingest/rescore';
import { gunzipJson } from '../ingest/storage';
import { type Range, rangeLabel, rangeWindows } from '../lib/range';
import { configForUser } from '../lib/user-config';
import { enabledSurfaces } from '../providers/types';
import { buildChangeReport } from '../routes/changes';
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
) => {
  const db = getDb(env);
  const { from } = rangeWindows(range);
  const { entities: trackedEntities, brand } = await loadEntitiesWithBrand(
    db,
    workspaceId,
  );
  if (!brand) {
    return { needsSetup: true, range, rangeLabel: rangeLabel(range) };
  }
  const [rows, coverageRows] = await Promise.all([
    loadScoreRows(db, workspaceId, from),
    loadCoverageRows(db, workspaceId, from),
  ]);
  const hasCompetitors = trackedEntities.some((entity) => !entity.isBrand);
  const mentionSov = hasCompetitors ? pooledSov(rows, 'mentioned') : null;
  const citationSov = hasCompetitors ? pooledSov(rows, 'cited') : null;
  const firstShares = hasCompetitors ? firstMentionShare(rows) : null;
  const surfaces = [...new Set(rows.map((row) => row.surface))]
    .sort()
    .map((surface) => {
      const scope = rows.filter((row) => row.surface === surface);
      return {
        surface,
        mentionRate: r3(cellRate(scope, brand.id, 'mentioned')),
        citationRate: r3(cellRate(scope, brand.id, 'cited')),
        averagePosition: r3(avgPosition(scope, brand.id)),
        answers: answerCount(scope),
      };
    });
  return {
    needsSetup: false,
    range,
    rangeLabel: rangeLabel(range),
    brand: brand.name,
    answers: answerCount(rows),
    mentionRate: r3(cellRate(rows, brand.id, 'mentioned')),
    citationRate: r3(cellRate(rows, brand.id, 'cited')),
    shareOfVoice: r3(shareOf(mentionSov, brand.id)),
    citationShareOfVoice: r3(shareOf(citationSov, brand.id)),
    averagePosition: r3(avgPosition(rows, brand.id)),
    firstNamedShare: r3(shareOf(firstShares, brand.id)),
    prominence: prominenceDist(rows, brand.id),
    sentiment: sentimentDist(rows, brand.id),
    coverage: coverageStats(coverageRows),
    surfaces,
  };
};

export const getCompetitorLandscape = async (
  env: AppEnv,
  workspaceId: number,
  range: Range,
) => {
  const db = getDb(env);
  const { from } = rangeWindows(range);
  const [trackedEntities, rows] = await Promise.all([
    listEntities(db, workspaceId),
    loadScoreRows(db, workspaceId, from),
  ]);
  const mentionSov = pooledSov(rows, 'mentioned');
  const citationSov = pooledSov(rows, 'cited');
  const firstShares = firstMentionShare(rows);
  const surfaceList = [...new Set(rows.map((row) => row.surface))].sort();
  return {
    range,
    rangeLabel: rangeLabel(range),
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
      surfaces: surfaceList.map((surface) => {
        const scope = rows.filter((row) => row.surface === surface);
        return {
          surface,
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
) => {
  const db = getDb(env);
  const { from } = rangeWindows(range);
  const { brand } = await loadEntitiesWithBrand(db, workspaceId);
  if (!brand) {
    return { needsSetup: true, range, rangeLabel: rangeLabel(range) };
  }
  const [trackedPrompts, scoreRows] = await Promise.all([
    db
      .select({
        id: prompts.id,
        text: prompts.text,
        tags: prompts.tags,
        active: prompts.active,
      })
      .from(prompts)
      .where(eq(prompts.workspaceId, workspaceId))
      .orderBy(prompts.id),
    loadScoreRows(db, workspaceId, from),
  ]);
  const brandRows = scoreRows.filter((row) => row.entityId === brand.id);
  const performance = trackedPrompts.map((prompt) => {
    const rows = brandRows.filter((row) => row.promptId === prompt.id);
    const mentionRate = r3(cellRate(rows, brand.id, 'mentioned'));
    return {
      id: prompt.id,
      text: prompt.text,
      tags: prompt.tags,
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
  return {
    needsSetup: false,
    range,
    rangeLabel: rangeLabel(range),
    brand: brand.name,
    prompts: performance,
    zeroVisibility: performance
      .filter((prompt) => prompt.answers > 0 && prompt.mentionRate === 0)
      .map((prompt) => ({ id: prompt.id, text: prompt.text })),
  };
};

export const getCitationSources = async (
  env: AppEnv,
  workspaceId: number,
  range: Range,
) => {
  const db = getDb(env);
  const { from } = rangeWindows(range);
  const { brand } = await loadEntitiesWithBrand(db, workspaceId);
  if (!brand) {
    return { needsSetup: true, range, rangeLabel: rangeLabel(range) };
  }
  const inRange = and(
    eq(results.ok, true),
    gte(runs.date, from),
    eq(runs.workspaceId, workspaceId),
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
  return report ?? { needsSetup: true };
};

export const getDigest = async (
  env: AppEnv,
  workspaceId: number,
  range: Range,
) => {
  const digest = await buildDigest(getDb(env), workspaceId, range);
  return digest ?? { needsSetup: true, range, rangeLabel: rangeLabel(range) };
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
      createdAt: runs.createdAt,
      completedAt: runs.completedAt,
    })
    .from(runs)
    .where(eq(runs.workspaceId, workspaceId))
    .orderBy(desc(runs.id))
    .limit(Math.max(1, Math.min(limit, 50)));
  return {
    runs: rows.map((row) => ({
      ...row,
      promptCount: row.promptCount === null ? null : Number(row.promptCount),
    })),
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
    return { needsSetup: true, range, rangeLabel: rangeLabel(range) };
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
