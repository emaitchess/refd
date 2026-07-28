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
