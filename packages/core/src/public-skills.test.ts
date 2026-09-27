import { describe, expect, test } from 'bun:test';
import { PUBLIC_PAGE_PATHS, PUBLIC_SITE_ORIGIN } from './public-pages';
import { PUBLIC_SKILLS } from './public-skills';

describe('public skills catalog', () => {
  test('every skill is a canonical, indexable public page', () => {
    for (const skill of PUBLIC_SKILLS) {
      expect(skill.path).toMatch(/^\/skills\/[a-z0-9-]+\/SKILL\.md$/);
      expect(PUBLIC_PAGE_PATHS).toContain(skill.path);
    }
  });

  test('skill names are unique and match their directory', () => {
    const names = PUBLIC_SKILLS.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);
    for (const skill of PUBLIC_SKILLS) {
      expect(skill.path).toContain(`/${skill.name}/`);
    }
  });
});

// The agent manifest is a static asset, which means nothing forces it to agree
// with the catalog. It is the first thing a self-directing agent reads, so a
// skill missing from it is invisible exactly where discovery matters most.
describe('agent manifest', () => {
  const manifest = Bun.file(
    new URL('../../../apps/web/public/.well-known/agent', import.meta.url),
  );

  test('lists every published skill with its canonical URL', async () => {
    const parsed = JSON.parse(await manifest.text()) as {
      skills: { name: string; url: string; description: string }[];
    };
    expect(Array.isArray(parsed.skills)).toBeTrue();
    expect(parsed.skills.map((skill) => [skill.name, skill.url])).toEqual(
      PUBLIC_SKILLS.map((skill) => [
        skill.name,
        `${PUBLIC_SITE_ORIGIN}${skill.path}`,
      ]),
    );
    for (const skill of parsed.skills) {
      expect(skill.description.length).toBeGreaterThan(0);
    }
  });
});
