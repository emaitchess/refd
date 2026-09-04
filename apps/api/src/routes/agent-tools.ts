// The Home agent's tool registry. Read/research only — every tool is a
// query; writes exist solely as human-confirmed proposals (see chat.ts).
// Each execution returns a step line for the live trace, a compact result
// string for the model transcript, and any web sources it surfaced.
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, getDb } from '../db/client';
import { entities, entityScores, prompts, results, runs } from '../db/schema';
import type { AppEnv } from '../env';
import { answerTextFromRaw } from '../ingest/rescore';
import { gunzipJson } from '../ingest/storage';
import { searchWeb, type WebResult } from '../lib/exa';
import { rangeLabel, rangeSchema } from '../lib/range';
import { buildDigest } from './digest';

export interface ToolOutcome {
  label: string;
  detail?: string;
  result: string;
  sources?: WebResult[];
}

// Rendered into the decision prompt. Kept terse: every token here is paid on
// every loop iteration.
export const toolCatalog = (hasWebSearch: boolean): string =>
  [
    hasWebSearch
      ? 'search_web {"query": string} — web search (Exa); returns numbered sources with snippets. Use for research beyond workspace data.'
      : null,
    'list_prompts {} — every tracked prompt with its exact wording. Call this when the user names a prompt you cannot match from the workspace data.',
    'get_prompt_results {"prompt": string} — find a tracked prompt by (partial) text; returns its latest per-surface results, entity mentions, and resultIds.',
    'read_answer {"resultId": number} — the stored AI answer text for one result (from get_prompt_results). Use for quote-level questions.',
    'get_digest {"range": "1d"|"3d"|"7d"|"30d"|"90d"|"all"} — the workspace metrics snapshot over another time window.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

const searchArgs = z.object({ query: z.string().min(2).max(200) });
const promptArgs = z.object({ prompt: z.string().min(2).max(500) });
const readArgs = z.object({ resultId: z.number().int().positive() });
const digestArgs = z.object({ range: rangeSchema });

const invalid = (name: string, expected: string): ToolOutcome => ({
  label: `${name} skipped`,
  detail: 'invalid arguments',
  result: `Tool ${name} was not run: invalid arguments. Expected ${expected}.`,
});

const runSearchWeb = async (
  env: AppEnv,
  args: unknown,
  sourceOffset: number,
): Promise<ToolOutcome> => {
  const parsed = searchArgs.safeParse(args);
  if (!parsed.success) {
    return invalid('search_web', '{"query": string}');
  }
  const found = await searchWeb(env, parsed.data.query);
  if (found.length === 0) {
    return {
      label: 'searched the web',
      detail: `"${parsed.data.query}" · no results`,
      result: `Web search for "${parsed.data.query}" returned no results.`,
    };
  }
  const lines = found
    .map(
      (r, i) =>
        `S${sourceOffset + i + 1}. ${r.title} (${r.url})${r.snippet ? ` — ${r.snippet}` : ''}`,
    )
    .join('\n');
  return {
    label: 'searched the web',
    detail: `"${parsed.data.query}" · ${found.length} results`,
    result: `Web results (cite by number):\n${lines}`,
    sources: found,
  };
};

const runGetPromptResults = async (
  db: Db,
  workspaceId: number,
  args: unknown,
): Promise<ToolOutcome> => {
  const parsed = promptArgs.safeParse(args);
  if (!parsed.success) {
    return invalid('get_prompt_results', '{"prompt": string}');
  }
  // Matching happens in JS, not SQL LIKE: D1 caps LIKE pattern length, and
  // models like to pass the full prompt text. Substring first, then a
  // token-overlap fallback so paraphrases still find their prompt.
  const all = await db
    .select({ id: prompts.id, text: prompts.text })
    .from(prompts)
    .where(eq(prompts.workspaceId, workspaceId))
    .limit(500);
  const query = parsed.data.prompt.toLocaleLowerCase();
  let matches = all.filter((p) => p.text.toLocaleLowerCase().includes(query));
  if (matches.length === 0) {
    const tokens = query.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    matches = all
      .map((p) => {
        const lower = p.text.toLocaleLowerCase();
        return {
          p,
          score: tokens.filter((t) => lower.includes(t)).length,
        };
      })
      .filter((s) => s.score >= Math.max(2, Math.ceil(tokens.length / 2)))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.p);
  }
  matches = matches.slice(0, 3);
  const match = matches[0];
  if (!match) {
    return {
      label: 'looked up a prompt',
      detail: 'no match',
      result: `No tracked prompt matches "${parsed.data.prompt}". Call list_prompts to see the exact wording of every tracked prompt.`,
    };
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
      label: 'looked up a prompt',
      detail: match.text.slice(0, 60),
      result: `Prompt "${match.text}" has no results yet.`,
    };
  }
  const rows = await db
    .select({
      resultId: results.id,
      surface: results.surface,
      sample: results.sample,
      ok: results.ok,
      answerPresent: results.answerPresent,
      hasRaw: sql<number>`case when ${results.r2Key} is not null then 1 else 0 end`,
    })
    .from(results)
    .where(
      and(eq(results.runId, latestRun.id), eq(results.promptId, match.id)),
    );
  const mentionRows = await db
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
        rows.map((r) => sql`${r.resultId}`),
        sql`, `,
      )})`,
    );
  const byResult = new Map<number, string[]>();
  for (const m of mentionRows) {
    if (!m.mentioned && !m.cited) {
      continue;
    }
    const list = byResult.get(m.resultId) ?? [];
    list.push(
      `${m.entity}${m.mentioned ? ` mentioned pos ${m.position}` : ''}${m.cited ? ' cited' : ''}${m.sentiment ? ` (${m.sentiment})` : ''}`,
    );
    byResult.set(m.resultId, list);
  }
  const lines = rows.map((r) => {
    const signals = byResult.get(r.resultId)?.join('; ') ?? 'no entity signals';
    const status = r.ok
      ? r.answerPresent
        ? 'ok'
        : 'no AI Overview'
      : 'failed';
    return `resultId ${r.resultId} · ${r.surface} sample ${r.sample} · ${status}${r.hasRaw ? '' : ' · no stored answer'} · ${signals}`;
  });
  const others =
    matches.length > 1
      ? `\nOther matching prompts: ${matches
          .slice(1)
          .map((m) => `"${m.text}"`)
          .join(', ')}`
      : '';
  return {
    label: 'looked up prompt results',
    detail: match.text.slice(0, 60),
    result: `Prompt: "${match.text}" (run ${latestRun.date}):\n${lines.join('\n')}${others}`,
  };
};

// Enough for any workspace under the hosted ceilings, with retired prompts
// included: history keeps them, so a question can name one.
const PROMPT_LIST_MAX = 100;

const runListPrompts = async (
  db: Db,
  workspaceId: number,
): Promise<ToolOutcome> => {
  const rows = await db
    .select({ text: prompts.text, active: prompts.active })
    .from(prompts)
    .where(eq(prompts.workspaceId, workspaceId))
    .orderBy(prompts.id)
    .limit(PROMPT_LIST_MAX);
  if (rows.length === 0) {
    return {
      label: 'listed tracked prompts',
      detail: 'none tracked',
      result: 'This workspace has no prompts yet.',
    };
  }
  const active = rows.filter((p) => p.active).length;
  // Wording is verbatim: get_prompt_results matches on it.
  const lines = rows
    .map((p) => `- ${p.active ? 'active' : 'retired'}: "${p.text}"`)
    .join('\n');
  return {
    label: 'listed tracked prompts',
    detail: `${rows.length} prompts · ${active} active`,
    result: `Tracked prompts (pass the exact wording to get_prompt_results):\n${lines}`,
  };
};

const ANSWER_CHARS = 2500;

const runReadAnswer = async (
  env: AppEnv,
  db: Db,
  workspaceId: number,
  args: unknown,
): Promise<ToolOutcome> => {
  const parsed = readArgs.safeParse(args);
  if (!parsed.success) {
    return invalid('read_answer', '{"resultId": number}');
  }
  // Ownership travels through the run join — a foreign resultId reads as
  // nonexistent, exactly like the REST routes.
  const row = (
    await db
      .select({
        id: results.id,
        provider: results.provider,
        surface: results.surface,
        r2Key: results.r2Key,
        promptId: results.promptId,
      })
      .from(results)
      .innerJoin(runs, eq(results.runId, runs.id))
      .where(
        and(
          eq(results.id, parsed.data.resultId),
          eq(runs.workspaceId, workspaceId),
        ),
      )
  )[0];
  if (!row) {
    return {
      label: 'read an answer',
      detail: 'not found',
      result: `No result ${parsed.data.resultId} in this workspace.`,
    };
  }
  if (!row.r2Key) {
    return {
      label: 'read an answer',
      detail: `${row.surface} · no stored answer`,
      result: `Result ${row.id} has no stored answer payload.`,
    };
  }
  const object = await env.RAW.get(row.r2Key);
  if (!object?.body) {
    return {
      label: 'read an answer',
      detail: `${row.surface} · payload missing`,
      result: `Result ${row.id}'s stored payload is unavailable.`,
    };
  }
  const text = answerTextFromRaw(row.provider, await gunzipJson(object.body));
  if (!text) {
    return {
      label: 'read an answer',
      detail: `${row.surface} · empty`,
      result: `Result ${row.id} has no readable answer text.`,
    };
  }
  const clipped =
    text.length > ANSWER_CHARS ? `${text.slice(0, ANSWER_CHARS)}…` : text;
  return {
    label: 'read an answer',
    detail: `${row.surface} · result ${row.id}`,
    result: `Answer text for result ${row.id} (${row.surface}):\n${clipped}`,
  };
};

const runGetDigest = async (
  db: Db,
  workspaceId: number,
  args: unknown,
): Promise<ToolOutcome> => {
  const parsed = digestArgs.safeParse(args);
  if (!parsed.success) {
    return invalid(
      'get_digest',
      '{"range": "7d" | "30d" | "90d" | "all" | ...}',
    );
  }
  const digest = await buildDigest(db, workspaceId, parsed.data.range);
  if (!digest) {
    return {
      label: 're-read the snapshot',
      detail: 'workspace not set up',
      result: 'The workspace has no brand configured.',
    };
  }
  return {
    label: 're-read the snapshot',
    detail: rangeLabel(parsed.data.range),
    result: `Workspace data, ${digest.rangeLabel}:\n${JSON.stringify(digest.sections)}`,
  };
};

export const executeTool = async (
  env: AppEnv,
  workspaceId: number,
  name: string,
  args: unknown,
  sourceOffset: number,
): Promise<ToolOutcome> => {
  const db = getDb(env);
  try {
    if (name === 'search_web') {
      return await runSearchWeb(env, args, sourceOffset);
    }
    if (name === 'list_prompts') {
      return await runListPrompts(db, workspaceId);
    }
    if (name === 'get_prompt_results') {
      return await runGetPromptResults(db, workspaceId, args);
    }
    if (name === 'read_answer') {
      return await runReadAnswer(env, db, workspaceId, args);
    }
    if (name === 'get_digest') {
      return await runGetDigest(db, workspaceId, args);
    }
    return {
      label: 'unknown tool',
      detail: name.slice(0, 40),
      result: `Unknown tool "${name}". Available tools are listed in your instructions.`,
    };
  } catch (error) {
    // A tool crash is a data point, never a dead conversation. The error
    // rides in the trace: this is an operator-facing surface and a silent
    // "failed" is undebuggable.
    console.error('agent tool failure', name, error);
    return {
      label: `${name} failed`,
      detail: `${JSON.stringify(args)?.slice(0, 60)} · ${String(
        error instanceof Error && error.cause ? error.cause : error,
      ).slice(0, 120)}`,
      result: `Tool ${name} failed to run. Answer with what you already have.`,
    };
  }
};
