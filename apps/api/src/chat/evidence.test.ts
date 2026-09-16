import { describe, expect, test } from 'bun:test';
import type { ChatScope } from '@refd/core/chat';
import type { WorkspaceDigest } from '../routes/digest';
import {
  createEvidenceRegistry,
  evidenceSources,
  persistedEvidence,
  registerToolEvidence,
  resolveEvidencePanels,
  selectEvidenceIds,
} from './evidence';

const scope: ChatScope = {
  version: 1,
  timezone: 'UTC',
  granularity: 'run_date',
  asOf: '2026-09-16',
  from: '2026-08-18',
  to: '2026-09-16',
  label: 'last 30 days (2026-08-18 to 2026-09-16)',
  source: 'default',
};

const digest = {
  brand: 'mrmr',
  rangeLabel: scope.label,
  scope,
  sections: { overview: { answers: 10 }, surfaces: [] },
} as unknown as WorkspaceDigest;

const webRecord = (
  registry: ReturnType<typeof createEvidenceRegistry>,
  sourceNum: number,
) =>
  registerToolEvidence(
    registry,
    'search_web',
    { query: 'mrmr reviews' },
    'Web results (cite by number):\nS1. Example',
    scope,
    {
      provenance: [
        {
          kind: 'web',
          url: 'https://example.com/review',
          title: 'Example',
          retrieval: 'search',
          retrievedAt: 1_800_000_000_000,
          sourceNum,
        },
      ],
    },
  );

describe('evidence registry', () => {
  test('the digest is E0 and carries its own scope and panels', () => {
    const registry = createEvidenceRegistry(digest);
    expect(registry.records).toHaveLength(1);
    expect(registry.records[0]?.id).toBe('E0');
    expect(registry.records[0]?.scope).toEqual(scope);
    expect(registry.records[0]?.panels).toEqual(digest.sections);
  });

  test('executed tools get sequential ids and keep their arguments', () => {
    const registry = createEvidenceRegistry(digest);
    const first = registerToolEvidence(
      registry,
      'query_results',
      { limit: 5 },
      '5 answers',
      scope,
    );
    const second = registerToolEvidence(
      registry,
      'aggregate',
      { groupBy: 'surface' },
      '3 groups',
      scope,
      { status: 'partial' },
    );
    expect(first.id).toBe('E1');
    expect(second.id).toBe('E2');
    expect(second.status).toBe('partial');
    expect(first.arguments).toEqual({ limit: 5 });
  });

  test('selection follows E-markers, S-markers, and metadata ids, dropping unknowns', () => {
    const registry = createEvidenceRegistry(digest);
    registerToolEvidence(registry, 'query_results', {}, 'rows', scope);
    webRecord(registry, 1);
    expect(selectEvidenceIds('used (E1) and (E2)', [], registry)).toEqual([
      'E1',
      'E2',
    ]);
    expect(selectEvidenceIds('a web claim (S1)', [], registry)).toEqual(['E2']);
    expect(selectEvidenceIds('(E1) plus (S1)', ['E0', 'E9'], registry)).toEqual(
      ['E1', 'E2', 'E0'],
    );
    expect(selectEvidenceIds('(E99)', ['E9'], registry)).toEqual([]);
  });

  test('a panel renders only from selected evidence, under that record scope', () => {
    const registry = createEvidenceRegistry(digest);
    const narrowScope: ChatScope = {
      ...scope,
      from: '2026-09-12',
      to: '2026-09-12',
      label: 'yesterday (2026-09-12)',
      source: 'explicit',
    };
    const digestTool = registerToolEvidence(
      registry,
      'get_digest',
      {},
      'narrow snapshot',
      scope,
      {
        scope: narrowScope,
        panels: { overview: { answers: 1 } },
      },
    );
    // Unselected evidence cannot freeze a panel, however valid.
    expect(
      resolveEvidencePanels(
        registry,
        [],
        [{ evidenceId: digestTool.id, key: 'overview' }],
      ),
    ).toEqual({ panels: [], panelData: null });
    expect(
      resolveEvidencePanels(
        registry,
        [digestTool.id],
        [
          { evidenceId: digestTool.id, key: 'overview' },
          { evidenceId: digestTool.id, key: 'missing_key' },
          { evidenceId: 'E0', key: 'overview' },
        ],
      ),
    ).toEqual({
      panels: ['overview'],
      panelData: {
        _window: narrowScope.label,
        _scope: narrowScope,
        overview: { answers: 1 },
      },
    });
  });

  test('sources derive deterministically from prose markers', () => {
    const registry = createEvidenceRegistry(digest);
    webRecord(registry, 1);
    webRecord(registry, 2);
    expect(
      evidenceSources('first (S2), then (S1), repeat (S2)', registry),
    ).toEqual([
      {
        title: 'Example',
        url: 'https://example.com/review',
        num: 2,
        evidenceId: 'E2',
      },
      {
        title: 'Example',
        url: 'https://example.com/review',
        num: 1,
        evidenceId: 'E1',
      },
    ]);
    expect(evidenceSources('(S9) invented', registry)).toEqual([]);
  });

  test('persisted records strip the panel payload', () => {
    const registry = createEvidenceRegistry(digest);
    registerToolEvidence(registry, 'get_digest', {}, 'snapshot', scope, {
      panels: { overview: { answers: 1 } },
    });
    const persisted = persistedEvidence(registry);
    expect(persisted).toHaveLength(2);
    expect(persisted.map((record) => record.id)).toEqual(['E0', 'E1']);
    for (const record of persisted) {
      expect('panels' in record).toBe(false);
    }
  });
});
