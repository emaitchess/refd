// Idle-state chips for the Home agent: what is worth asking about this
// workspace right now.
//
// The rule every candidate obeys is that a chip states a number and names a
// thing — a prompt, a rival, a surface, a domain. "Which prompts have zero
// visibility?" is a category; "WisprFlow appears in 89% of answers to one
// prompt and the brand in 1%" is a lead. The first is true of almost every
// workspace on almost every day, which is exactly why it reads as filler.
//
// Candidates from different families are not comparable in raw units: a
// citation drift of 8 points and a competitor gap of 88 points are both
// worth saying, and sorting them on magnitude alone would let the gap win
// every time. So each family declares the bar at which it becomes worth
// saying, and `strength` is how far past its own bar the observation landed.
// Below the bar a candidate is dropped rather than ranked, so a quiet
// workspace gets fewer chips instead of weaker ones.

import { surfaceLabel } from '@refd/core/surfaces';
import type { ChangeEvent } from './changes';
import type { DigestSections } from './digest';

export type SuggestionKind =
  | 'contested'
  | 'change'
  | 'named-split'
  | 'surface'
  | 'zero-visibility'
  | 'source-gap'
  | 'collection'
  | 'starter';

export interface Suggestion {
  kind: SuggestionKind;
  // What the chip shows: short, and carrying the number that makes it worth
  // a click.
  label: string;
  // What gets sent to the agent: the same fact stated in full, so the answer
  // starts from the evidence rather than rediscovering it.
  question: string;
  strength: number;
}

// The bar per family, in that family's own units.
const BAR = {
  // Gap between the leading rival's mention rate and the brand's on one
  // prompt. Forty points is a rout rather than a race.
  contested: 0.4,
  // Matches RATE_PP: an event exists only because it already cleared the
  // engine's threshold, so anything here is at least at the bar.
  change: 0.05,
  // Gap between visibility on prompts that name the brand and prompts that
  // do not. Some gap is normal; twenty points means the headline is carried
  // by self-reference.
  namedSplit: 0.2,
  // How far the weakest surface trails the strongest on mention rate.
  surface: 0.1,
  // Share of answered prompts the brand never appears in. A quarter is where
  // a standing count becomes news; below that a measured movement in the
  // same list of chips is the better use of the slot.
  zeroVisibility: 0.25,
  // Answers citing a gap domain, as a share of all answers in the window.
  sourceGap: 0.15,
  // Share of a run's expected answers that never arrived.
  collection: 0.1,
} as const;

// At most two chips from one family: four variations on the same finding is
// a worse briefing than four different ones, however large the finding.
const PER_KIND_MAX = 2;

// Contested prompts collapse to one chip per rival, and a rival holding this
// many of them is described as a pattern rather than as one example: two
// chips reading "WisprFlow 98% vs mrmr 0%" and "WisprFlow 89% vs mrmr 1%"
// spend two of four slots saying the same thing.
const CLUSTER_MIN = 3;

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;

// Prompt text inside a chip has to survive a single line. The question keeps
// the prompt whole; only the label trims.
const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const contestedCandidates = (
  sections: DigestSections,
  brand: string,
): Suggestion[] => {
  const qualifying = sections.prompts.contested.filter(
    (p) => (p.leaderRate ?? 0) - (p.mentionRate ?? 0) >= BAR.contested,
  );
  // The digest caps the list it carries, so a leader's visible count can be
  // short of its real one. Say "at least" rather than a number that might
  // undercount, and never a number that might overstate.
  const truncated =
    sections.prompts.contestedCount > sections.prompts.contested.length;
  const byLeader = new Map<string, typeof qualifying>();
  for (const p of qualifying) {
    byLeader.set(p.leader, [...(byLeader.get(p.leader) ?? []), p]);
  }
  return [...byLeader.entries()].flatMap(([leader, held]) => {
    const sharpest = held[0];
    if (!sharpest) {
      return [];
    }
    const gap = (sharpest.leaderRate ?? 0) - (sharpest.mentionRate ?? 0);
    const strength = gap / BAR.contested;
    if (held.length < CLUSTER_MIN) {
      return [
        {
          kind: 'contested' as const,
          label: `${leader} ${pct(sharpest.leaderRate)} vs ${brand} ${pct(sharpest.mentionRate)} on one prompt`,
          question: `The prompt "${sharpest.text}" mentions ${leader} in ${pct(sharpest.leaderRate)} of its answers and ${brand} in ${pct(sharpest.mentionRate)}, across ${sharpest.answers} answers. What are those answers saying about ${leader}, and what would it take for ${brand} to appear there?`,
          strength,
        },
      ];
    }
    return [
      {
        kind: 'contested' as const,
        label: `${leader} leads ${held.length}${truncated ? '+' : ''} prompts ${brand} is absent from`,
        question: `${leader} is mentioned in most answers to ${truncated ? 'at least ' : ''}${held.length} tracked prompts where ${brand} is effectively absent, the sharpest being "${sharpest.text}" at ${pct(sharpest.leaderRate)} versus ${pct(sharpest.mentionRate)}. What do those answers credit ${leader} with, and which of these prompts is ${brand} closest to breaking into?`,
        strength,
      },
    ];
  });
};

// Change events arrive pre-phrased by the engine, which already owns the
// honest wording of a delta. The chip shows the headline, the agent gets the
// question — no restating a measurement in a second voice.
const changeCandidates = (events: ChangeEvent[]): Suggestion[] =>
  events.map((event) => ({
    kind: 'change' as const,
    label: event.headline,
    question: event.question,
    strength: Math.max(event.severity / BAR.change, 1),
  }));

const namedSplitCandidates = (
  sections: DigestSections,
  brand: string,
): Suggestion[] => {
  const { named, unnamed } = sections.prompts.namedSplit;
  if (
    named.mentionRate === null ||
    unnamed.mentionRate === null ||
    named.prompts === 0 ||
    unnamed.prompts === 0
  ) {
    return [];
  }
  const gap = named.mentionRate - unnamed.mentionRate;
  if (gap < BAR.namedSplit) {
    return [];
  }
  return [
    {
      kind: 'named-split',
      label: `${pct(unnamed.mentionRate)} visibility on prompts that don't name ${brand}`,
      question: `${brand} is mentioned in ${pct(named.mentionRate)} of answers to the ${named.prompts} prompts that spell out its name, but only ${pct(unnamed.mentionRate)} of answers to the other ${unnamed.prompts}. Which of those unprompted questions is ${brand} closest to breaking into?`,
      strength: gap / BAR.namedSplit,
    },
  ];
};

const surfaceCandidates = (
  sections: DigestSections,
  brand: string,
): Suggestion[] => {
  const rated = sections.surfaces.filter((s) => s.mentionRate !== null);
  if (rated.length < 2) {
    return [];
  }
  const sorted = [...rated].sort(
    (a, b) => (a.mentionRate ?? 0) - (b.mentionRate ?? 0),
  );
  const worst = sorted[0];
  const best = sorted.at(-1);
  if (!worst || !best) {
    return [];
  }
  const gap = (best.mentionRate ?? 0) - (worst.mentionRate ?? 0);
  if (gap < BAR.surface) {
    return [];
  }
  const low = surfaceLabel(worst.surface);
  const high = surfaceLabel(best.surface);
  return [
    {
      kind: 'surface',
      label: `${pct(worst.mentionRate)} on ${low} vs ${pct(best.mentionRate)} on ${high}`,
      question: `${brand} is mentioned in ${pct(worst.mentionRate)} of ${low} answers but ${pct(best.mentionRate)} of ${high} answers, over ${worst.answers} and ${best.answers} answers respectively. What is different about how ${low} builds its answers?`,
      strength: gap / BAR.surface,
    },
  ];
};

const zeroVisibilityCandidates = (
  sections: DigestSections,
  brand: string,
): Suggestion[] => {
  const { zeroVisibilityCount, answered, zeroVisibility } = sections.prompts;
  if (answered === 0 || zeroVisibilityCount === 0) {
    return [];
  }
  const share = zeroVisibilityCount / answered;
  if (share < BAR.zeroVisibility) {
    return [];
  }
  const example = zeroVisibility[0];
  return [
    {
      kind: 'zero-visibility',
      label: `${zeroVisibilityCount} of ${answered} prompts never mention ${brand}`,
      question: `${zeroVisibilityCount} of the ${answered} answered prompts never mention ${brand}${example ? `, starting with "${example}"` : ''}. Which of them share a theme, and which is the most winnable?`,
      strength: share / BAR.zeroVisibility,
    },
  ];
};

const sourceGapCandidates = (
  sections: DigestSections,
  brand: string,
): Suggestion[] => {
  const top = sections.sources.gap[0];
  const answers = sections.overview.answers;
  if (!top || answers === 0) {
    return [];
  }
  const share = top.answersCiting / answers;
  if (share < BAR.sourceGap) {
    return [];
  }
  return [
    {
      kind: 'source-gap',
      label: `${top.domain} cited in ${top.answersCiting} answers without ${brand}`,
      question: `AI answers cite ${top.domain} in ${top.answersCiting} answers where ${brand} is neither mentioned nor cited. What are those answers citing it for, and is there an equivalent page on our side?`,
      strength: share / BAR.sourceGap,
    },
  ];
};

// A run that lost answers is a data problem wearing a visibility costume:
// every rate it feeds is computed over what did arrive. Worth a chip when
// the shortfall is big enough to move them.
const collectionCandidates = (sections: DigestSections): Suggestion[] => {
  const latest = sections.runs[0];
  if (!latest) {
    return [];
  }
  const [ok, total] = latest.answersCollected.split('/').map(Number);
  if (!ok || !total || total === 0) {
    return [];
  }
  const missing = (total - ok) / total;
  if (missing < BAR.collection) {
    return [];
  }
  return [
    {
      kind: 'collection',
      label: `${latest.date} run collected ${ok} of ${total} answers`,
      question: `The run on ${latest.date} collected ${ok} of ${total} expected answers. Which prompts and surfaces are missing, and has the same gap shown up in earlier runs?`,
      strength: missing / BAR.collection,
    },
  ];
};

// The floor. A workspace on its first run has no deltas, no contested
// prompts and no source gap, and four empty slots would read as breakage.
// These are the only canned strings left, and they only ever fill space the
// measured candidates did not.
const starters = (brand: string): Suggestion[] =>
  [
    `How is ${brand} performing across surfaces?`,
    `Which sources cite ${brand} the most?`,
    `How do AI answers portray ${brand}?`,
    `How does ${brand} compare to competitors?`,
  ].map((text) => ({
    kind: 'starter' as const,
    label: text,
    question: text,
    strength: 0,
  }));

// Strongest first, at most PER_KIND_MAX per family, starters only as filler.
export const rankSuggestions = (
  candidates: Suggestion[],
  limit: number,
): Suggestion[] => {
  const measured = candidates
    .filter((c) => c.kind !== 'starter' && c.strength >= 1)
    .sort((a, b) => b.strength - a.strength);
  const used = new Map<SuggestionKind, number>();
  const picked: Suggestion[] = [];
  for (const candidate of measured) {
    if (picked.length >= limit) {
      break;
    }
    const count = used.get(candidate.kind) ?? 0;
    if (count >= PER_KIND_MAX) {
      continue;
    }
    used.set(candidate.kind, count + 1);
    picked.push(candidate);
  }
  for (const filler of candidates.filter((c) => c.kind === 'starter')) {
    if (picked.length >= limit) {
      break;
    }
    picked.push(filler);
  }
  return picked;
};

export const buildSuggestions = (
  brand: string,
  sections: DigestSections,
  events: ChangeEvent[],
  limit: number,
): Suggestion[] =>
  rankSuggestions(
    [
      ...contestedCandidates(sections, brand),
      ...changeCandidates(events),
      ...namedSplitCandidates(sections, brand),
      ...surfaceCandidates(sections, brand),
      ...zeroVisibilityCandidates(sections, brand),
      ...sourceGapCandidates(sections, brand),
      ...collectionCandidates(sections),
      ...starters(brand),
    ].map((s) => ({ ...s, label: clip(s.label, 64) })),
    limit,
  );
