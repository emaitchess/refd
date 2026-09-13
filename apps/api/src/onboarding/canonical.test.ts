import { describe, expect, test } from 'bun:test';
import {
  type CanonicalizationInput,
  canonicalConfigurationHash,
  canonicalizeSetupConfiguration,
  stableStringify,
} from './canonical';

const input: CanonicalizationInput = {
  workspaceName: 'Acme  \r\nRobotics',
  brandName: 'Acmé Robotics',
  brandDomains: ['example.com', 'acme.dev'],
  brandAliases: [
    { value: 'Acmé', caseSensitive: true },
    { value: 'acme corp' },
  ],
  description: 'Builds  café-grade robots.',
  summary: 'Robot maker',
  targetMarket: 'EU cafés',
  competitors: [
    {
      draftId: 'b-second',
      name: 'Beta Bots',
      domains: ['beta.example', 'beta.dev'],
      aliases: [{ value: 'Beta' }],
    },
    {
      draftId: 'a-first',
      name: 'Alpha Droids',
      domains: ['alpha.example'],
      aliases: [],
    },
  ],
  prompts: [
    { draftId: 'p2', text: 'best robots for cafés?', category: 'Product' },
    { draftId: 'p1', text: 'who makes café robots?', category: 'Brand' },
  ],
  enabledSurfaces: ['google_aio', 'chatgpt'],
};

describe('canonicalizeSetupConfiguration', () => {
  test('normalizes, sorts, and hashes deterministically', async () => {
    const canonical = canonicalizeSetupConfiguration(input);
    // NFC composition: the input é (decomposed) equals the precomposed one.
    expect(canonical.brand.name).toBe('Acmé Robotics');
    expect(canonical.workspace.name).toBe('Acme  \nRobotics');
    expect(canonical.brand.domains).toEqual(['acme.dev', 'example.com']);
    // Aliases sort by code-unit value first, then caseSensitive false first
    // ('A' sorts before 'a' in UTF-16 order).
    expect(canonical.brand.aliases).toEqual([
      { value: 'Acmé', caseSensitive: true },
      { value: 'acme corp', caseSensitive: false },
    ]);
    // Records sort by draftId, not input order.
    expect(canonical.competitors.map((c) => c.draftId)).toEqual([
      'a-first',
      'b-second',
    ]);
    expect(canonical.prompts.map((p) => p.draftId)).toEqual(['p1', 'p2']);
    // Surfaces take the canonical surface order regardless of input order.
    expect(canonical.enabledSurfaces).toEqual(['chatgpt', 'google_aio']);

    const hash = await canonicalConfigurationHash(canonical);
    // Golden bytes: the exact stable JSON this canonical form must produce.
    const expectedJson =
      '{"brand":{"aliases":[{"caseSensitive":true,"value":"Acmé"},{"caseSensitive":false,"value":"acme corp"}],"domains":["acme.dev","example.com"],"name":"Acmé Robotics"},"competitors":[{"aliases":[],"domains":["alpha.example"],"draftId":"a-first","name":"Alpha Droids"},{"aliases":[{"caseSensitive":false,"value":"Beta"}],"domains":["beta.dev","beta.example"],"draftId":"b-second","name":"Beta Bots"}],"enabledSurfaces":["chatgpt","google_aio"],"profile":{"description":"Builds  café-grade robots.","summary":"Robot maker","targetMarket":"EU cafés"},"prompts":[{"category":"Brand","draftId":"p1","text":"who makes café robots?"},{"category":"Product","draftId":"p2","text":"best robots for cafés?"}],"schemaVersion":1,"workspace":{"name":"Acme  \\nRobotics"}}';
    expect(stableStringify(canonical)).toBe(expectedJson);
    const expectedHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(expectedJson),
    );
    expect(hash).toBe(
      [...new Uint8Array(expectedHash)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    );
  });

  test('is invariant to input ordering, Unicode form, and line endings', async () => {
    const shuffled: CanonicalizationInput = {
      ...input,
      workspaceName: 'Acme  \rRobotics',
      brandName: 'Acme\u0301 Robotics',
      brandDomains: [...input.brandDomains].reverse(),
      brandAliases: [...input.brandAliases].reverse(),
      competitors: [...input.competitors].reverse(),
      prompts: [...input.prompts].reverse(),
      enabledSurfaces: [...input.enabledSurfaces].reverse(),
    };
    const base = await canonicalConfigurationHash(
      canonicalizeSetupConfiguration(input),
    );
    const other = await canonicalConfigurationHash(
      canonicalizeSetupConfiguration(shuffled),
    );
    expect(other).toBe(base);
  });

  test('a canonically different value changes the hash', async () => {
    const base = await canonicalConfigurationHash(
      canonicalizeSetupConfiguration(input),
    );
    const changed = await canonicalConfigurationHash(
      canonicalizeSetupConfiguration({
        ...input,
        summary: 'Robot makers',
      }),
    );
    expect(changed).not.toBe(base);
  });

  test('empty optional fields are explicit, never undefined', () => {
    const canonical = canonicalizeSetupConfiguration({
      ...input,
      description: '',
      competitors: [],
      prompts: [],
    });
    expect(canonical.profile.description).toBe('');
    expect(canonical.competitors).toEqual([]);
    expect(stableStringify(canonical)).not.toContain('undefined');
  });
});
