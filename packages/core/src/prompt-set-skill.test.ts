import { describe, expect, test } from 'bun:test';
import { PROMPT_CATEGORIES, STANDARD_LIMITS } from './config';
import { METRIC_INFO } from './metric-copy';
import { PROMPT_KINDS } from './prompt-cohorts';
import { AI_PROMPT_SET_DESIGN_SKILL } from './prompt-set-skill';
import { SURFACE_LABELS, SURFACES } from './surfaces';

// The prompt set design skill states product behaviour to agents that have never
// seen the product. Limits, surfaces, and prompt categories are interpolated from
// core, so they cannot drift. The change thresholds are prose, so they are pinned
// here against the same glossary copy the engine constants are pinned to by
// changes.test.ts. The two guard counts have no home in core (they are engine
// internals), so they are asserted literally with their source named.
const SKILL = AI_PROMPT_SET_DESIGN_SKILL.replace(/\s+/g, ' ');
const PROMPT_CATEGORIES_JOINED = `${PROMPT_CATEGORIES.slice(0, -1).join(', ')}, and ${PROMPT_CATEGORIES.at(-1)}`;

describe('prompt set design skill', () => {
  test('interpolates the account limits and the surface list from core', () => {
    expect(SKILL).toContain(
      `up to ${STANDARD_LIMITS.maxActivePromptsPerWorkspace} active prompts`,
    );
    expect(SKILL).toContain(
      `${STANDARD_LIMITS.maxEnabledSurfacesPerWorkspace} of the ${SURFACES.length} surfaces`,
    );
    for (const label of SURFACES.map((id) => SURFACE_LABELS[id])) {
      expect(SKILL).toContain(label);
    }
  });

  test('interpolates the generated prompt categories from core', () => {
    expect(SKILL).toContain(PROMPT_CATEGORIES_JOINED);
  });

  test('states the same change thresholds the glossary states', () => {
    const copy = METRIC_INFO.materialChange.definition;
    for (const fragment of [
      '5 points',
      '4 points',
      'quarter of a rank',
    ] as const) {
      expect(copy).toContain(fragment);
      expect(SKILL).toContain(fragment);
    }
    // Guard counts: MIN_CELLS and MIN_CONDITIONAL_N in
    // apps/api/src/routes/changes.ts, BAR.namedSplit in
    // apps/api/src/routes/suggestions.ts.
    expect(SKILL).toContain('at least 4 shared cells');
    expect(SKILL).toContain('at least 3 positioned or classified mentions');
    expect(SKILL).toContain('by 20 points');
  });

  test('cites every source it makes an empirical claim from', () => {
    for (const source of [
      'arxiv.org/abs/2606.20065',
      'arxiv.org/abs/2605.27440',
      'arxiv.org/abs/2605.30207',
      'arxiv.org/abs/2607.13304',
      'arxiv.org/abs/2410.02185',
      'github.com/chirag23177/geo-probe',
      'arxiv.org/abs/2311.09735',
    ]) {
      expect(SKILL).toContain(source);
    }
  });

  test('keeps the platform-neutral promise and labels the vendor section', () => {
    expect(SKILL).toContain('Platform neutral');
    expect(SKILL).toContain('### refd handles');
    expect(SKILL).toContain('### You still do by hand');
  });

  test('names the cohort ids from core rather than restating them', () => {
    for (const kind of PROMPT_KINDS) {
      expect(SKILL).toContain(`\`${kind}\``);
    }
  });

  test('does not claim prompt-set versioning, which does not exist', () => {
    expect(SKILL).toContain('there is no prompt-set revision number');
  });

  test('avoids the em dash house style', () => {
    expect(AI_PROMPT_SET_DESIGN_SKILL).not.toContain('\u2014');
  });
});
