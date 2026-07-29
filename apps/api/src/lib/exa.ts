import { getDomain } from 'tldts';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { llmText, parseJson, runChat } from './llm';
import { validate } from './validate';

// Competitor discovery via Exa (retrieval) + glm-5.2 (curation). The split is
// the point: Sonar fabricated domains when asked to *generate* a competitor
// list, so here every domain comes from a real indexed search result and the
// LLM only selects among numbered candidates — it cannot invent one.
const SEARCH_URL = 'https://api.exa.ai/search';
const SIMILAR_URL = 'https://api.exa.ai/findSimilar';
const TIMEOUT_MS = 20000;
const NUM_RESULTS = 10;

export interface DiscoveredCompetitor {
  name: string;
  domain: string;
  domains: string[];
  aliases: { value: string; caseSensitive: boolean }[];
}

// category=company results include profile/aggregator pages alongside real
// homepages, and Exa rejects excludeDomains with that category — so the
// filter lives here, keyed by registrable domain. Deliberately only sites
// that can never be a tracked competitor; borderline cases (app stores,
// big-tech domains) are left for the curation step to drop.
const AGGREGATOR_DOMAINS = new Set([
  'linkedin.com',
  'crunchbase.com',
  'wikipedia.org',
  'g2.com',
  'capterra.com',
  'getapp.com',
  'softwareadvice.com',
  'trustpilot.com',
  'trustradius.com',
  'producthunt.com',
  'glassdoor.com',
  'pitchbook.com',
  'owler.com',
  'zoominfo.com',
  'tracxn.com',
  'cbinsights.com',
  'medium.com',
  'substack.com',
  'youtube.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'reddit.com',
  'github.com',
]);

// Lenient per-result parse: one malformed row never discards the response.
const resultSchema = z.looseObject({
  url: z.string().min(1),
  title: z.string().catch(''),
  text: z.string().catch(''),
  entities: z
    .array(
      z.looseObject({
        type: z.string().catch(''),
        properties: z
          .looseObject({
            name: z.string().catch(''),
            description: z.string().catch(''),
          })
          .catch({ name: '', description: '' }),
      }),
    )
    .catch([]),
});
const envelopeSchema = z.object({ results: z.array(z.unknown()).catch([]) });

interface Candidate {
  domain: string;
  label: string;
  description: string;
}

const exaResults = async (
  env: AppEnv,
  url: string,
  body: Record<string, unknown>,
): Promise<z.infer<typeof resultSchema>[]> => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': env.EXA_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return [];
    }
    const data = validate(await res.json(), envelopeSchema);
    return (data?.results ?? []).flatMap((item) => {
      const parsed = resultSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
};

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

// General web search for the Home agent: retrieval only — results get
// numbered upstream so the model can only cite pages that exist. Empty on
// any failure or when EXA_API_KEY is absent (the tool is simply not offered).
export const searchWeb = async (
  env: AppEnv,
  query: string,
  numResults = 8,
): Promise<WebResult[]> => {
  if (!env.EXA_API_KEY) {
    return [];
  }
  const results = await exaResults(env, SEARCH_URL, {
    query,
    type: 'auto',
    numResults,
    contents: { text: { maxCharacters: 500 } },
  });
  const seen = new Set<string>();
  const out: WebResult[] = [];
  for (const result of results) {
    try {
      const parsed = new URL(result.url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        continue;
      }
    } catch {
      continue;
    }
    if (seen.has(result.url)) {
      continue;
    }
    seen.add(result.url);
    out.push({
      title: (result.title || result.url).trim().slice(0, 120),
      url: result.url,
      snippet: result.text.trim().slice(0, 400),
    });
  }
  return out;
};

// Real indexed pages → candidate companies, deduped by registrable domain.
// Two angles: a semantic company search (query-targeted) and the embedding
// neighbours of the brand's own homepage (works even for niches nobody has
// written a listicle about). Search results claim their domain first.
const searchCandidates = async (
  env: AppEnv,
  input: { brand: string; domains: string[]; summary: string },
): Promise<Candidate[]> => {
  const primary = input.domains[0] ?? '';
  const query =
    `Direct competitors of ${input.brand}` +
    (primary ? ` (${primary})` : '') +
    (input.summary ? `: ${input.summary}` : '');
  const contents = { text: true };
  const calls = [
    exaResults(env, SEARCH_URL, {
      query,
      type: 'auto',
      category: 'company',
      numResults: NUM_RESULTS,
      contents,
    }),
  ];
  if (primary) {
    calls.push(
      exaResults(env, SIMILAR_URL, {
        url: `https://${primary}`,
        excludeSourceDomain: true,
        category: 'company',
        numResults: NUM_RESULTS,
        contents,
      }),
    );
  }
  const batches = await Promise.all(calls);

  const own = new Set(input.domains.map((d) => d.toLowerCase()));
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const result of batches.flat()) {
    let host: string;
    try {
      const parsed = new URL(result.url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        continue;
      }
      host = parsed.hostname;
    } catch {
      continue;
    }
    const domain = getDomain(host)?.toLowerCase();
    if (
      !domain ||
      seen.has(domain) ||
      own.has(domain) ||
      AGGREGATOR_DOMAINS.has(domain)
    ) {
      continue;
    }
    seen.add(domain);
    const entity = result.entities.find((e) => e.type === 'company');
    const label = (entity?.properties.name || result.title || domain).trim();
    const description = (entity?.properties.description || result.text)
      .trim()
      .slice(0, 240);
    candidates.push({ domain, label, description });
  }
  return candidates;
};

const curationSchema = z.object({
  competitors: z
    .array(
      z.object({
        index: z.number().int(),
        name: llmText(100).pipe(z.string().min(1)),
        aliases: z
          .array(
            z.object({
              value: llmText(60).pipe(z.string().min(1)),
              caseSensitive: z.boolean().catch(false),
            }),
          )
          .max(8)
          .catch([]),
      }),
    )
    .max(12)
    .catch([]),
});

// The LLM's only powers: pick candidates by number, clean up their names, and
// suggest aliases. Domains are looked up from the picked candidate.
const curateCandidates = async (
  env: AppEnv,
  input: { brand: string; domains: string[]; summary: string },
  candidates: Candidate[],
): Promise<DiscoveredCompetitor[]> => {
  const system =
    'You curate competitor candidates for a brand-visibility monitoring tool. ' +
    'The user gives a brand and a numbered list of candidate companies found by real web search. ' +
    'Select only the direct competitors: companies offering a similar product or service to the same buyers. ' +
    'Exclude the brand itself, aggregators, directories, review sites, marketplaces, media, and companies in a different market. ' +
    'Return ONLY a JSON object {"competitors":[{"index":number,"name":string,"aliases":[{"value":string,"caseSensitive":boolean}]}]}. ' +
    '"index" is the candidate\'s number in the list. ' +
    '"name" is the company\'s proper name (clean up page titles). ' +
    '"aliases" are other names the company is commonly called in text: former names, parent/product names, well-known shorthands. Be conservative — include only unambiguous aliases (a wrong alias silently inflates metrics; a missing one is easily added later). Never include generic words or ambiguous acronyms. Set "caseSensitive": true when the alias is also an ordinary dictionary word (e.g. "Notion", "Loop") so only the branded casing counts. ' +
    'At most 8 competitors, best first. If no candidate is a real competitor, return {"competitors":[]}.';
  const lines = candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.label} (${c.domain})${c.description ? ` - ${c.description}` : ''}`,
    )
    .join('\n');
  const user =
    `Brand: ${input.brand}${input.domains[0] ? ` (${input.domains[0]})` : ''}\n` +
    (input.summary ? `About: ${input.summary}\n` : '') +
    `\nCandidates:\n${lines}\n\nSelect the direct competitors.`;

  const raw = await runChat(env, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  const curated = parseJson(raw, curationSchema)?.competitors ?? [];

  const used = new Set<number>();
  const competitors: DiscoveredCompetitor[] = [];
  for (const item of curated) {
    const candidate = candidates[item.index - 1];
    if (!candidate || used.has(item.index)) {
      continue;
    }
    used.add(item.index);
    competitors.push({
      name: item.name,
      domain: candidate.domain,
      domains: [candidate.domain],
      aliases: item.aliases,
    });
    if (competitors.length >= 8) {
      break;
    }
  }
  return competitors;
};

// Best-effort: returns [] on any failure — missing key, network, no
// candidates, unparseable curation — so onboarding degrades to manual entry
// rather than dead-ending.
export const discoverCompetitors = async (
  env: AppEnv,
  input: { brand: string; domains: string[]; summary: string },
): Promise<DiscoveredCompetitor[]> => {
  if (!env.EXA_API_KEY) {
    return [];
  }
  try {
    const candidates = await searchCandidates(env, input);
    if (candidates.length === 0) {
      return [];
    }
    return await curateCandidates(env, input, candidates);
  } catch {
    return [];
  }
};
