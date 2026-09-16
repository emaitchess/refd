import type {
  ChatEvidenceRecord,
  ChatScope,
  ChatWebSource,
} from '../db/schema';
import type { DigestPanel, WorkspaceDigest } from '../routes/digest';

export interface EvidenceInput {
  status?: ChatEvidenceRecord['status'];
  scope?: ChatScope;
  provenance?: ChatEvidenceRecord['provenance'];
  panels?: Partial<Record<DigestPanel, unknown>>;
}

export interface RegisteredEvidence extends ChatEvidenceRecord {
  panels?: Partial<Record<DigestPanel, unknown>>;
}

export interface EvidenceRegistry {
  records: RegisteredEvidence[];
}

export const createEvidenceRegistry = (
  digest: WorkspaceDigest,
): EvidenceRegistry => ({
  records: [
    {
      id: 'E0',
      status: 'ok',
      origin: 'digest',
      tool: null,
      arguments: null,
      result: `Workspace data, ${digest.rangeLabel}:\n${JSON.stringify(digest.sections)}`,
      scope: digest.scope,
      provenance: [{ kind: 'derived', derivation: 'digest' }],
      panels: digest.sections,
    },
  ],
});

export const registerToolEvidence = (
  registry: EvidenceRegistry,
  tool: string,
  args: unknown,
  result: string,
  scope: ChatScope,
  input?: EvidenceInput,
): RegisteredEvidence => {
  const record: RegisteredEvidence = {
    id: `E${registry.records.length}`,
    status: input?.status ?? 'ok',
    origin: 'tool',
    tool,
    arguments: args,
    result: result.slice(0, 30_000),
    scope: input?.scope ?? scope,
    provenance: input?.provenance ?? [],
    ...(input?.panels ? { panels: input.panels } : {}),
  };
  registry.records.push(record);
  return record;
};

const markerNumbers = (prose: string, prefix: 'E' | 'S'): number[] => [
  ...new Set(
    [...prose.matchAll(new RegExp(`\\(${prefix}(\\d+)\\)`, 'g'))].flatMap(
      (match) => {
        const value = Number.parseInt(match[1] ?? '', 10);
        return Number.isInteger(value) ? [value] : [];
      },
    ),
  ),
];

export const selectEvidenceIds = (
  prose: string,
  requested: string[],
  registry: EvidenceRegistry,
): string[] => {
  const valid = new Set(registry.records.map((record) => record.id));
  const sourceOwners = new Map<number, string>();
  for (const record of registry.records) {
    for (const provenance of record.provenance) {
      if (provenance.kind === 'web' && provenance.sourceNum) {
        sourceOwners.set(provenance.sourceNum, record.id);
      }
    }
  }
  return [
    ...new Set([
      ...markerNumbers(prose, 'E').map((number) => `E${number}`),
      ...markerNumbers(prose, 'S').flatMap((number) => {
        const owner = sourceOwners.get(number);
        return owner ? [owner] : [];
      }),
      ...requested,
    ]),
  ].filter((id) => valid.has(id));
};

export const persistedEvidence = (
  registry: EvidenceRegistry,
): ChatEvidenceRecord[] =>
  registry.records.map(({ panels: _panels, ...record }) => record);

export const resolveEvidencePanels = (
  registry: EvidenceRegistry,
  selectedIds: string[],
  requested: { evidenceId: string; key: string }[],
): {
  panels: DigestPanel[];
  panelData: Record<string, unknown> | null;
} => {
  const selected = new Set(selectedIds);
  const panels: DigestPanel[] = [];
  const data: Record<string, unknown> = {};
  let panelScope: ChatScope | null = null;
  for (const request of requested) {
    if (panels.length >= 2 || !selected.has(request.evidenceId)) {
      continue;
    }
    const record = registry.records.find(
      (candidate) => candidate.id === request.evidenceId,
    );
    if (
      !record?.panels ||
      !Object.hasOwn(record.panels as object, request.key)
    ) {
      continue;
    }
    const key = request.key as DigestPanel;
    if (panels.includes(key)) {
      continue;
    }
    panels.push(key);
    data[key] = record.panels[key];
    panelScope ??= record.scope;
  }
  return {
    panels,
    panelData:
      panels.length > 0 && panelScope
        ? { _window: panelScope.label, _scope: panelScope, ...data }
        : null,
  };
};

export const evidenceSources = (
  prose: string,
  registry: EvidenceRegistry,
): ChatWebSource[] => {
  const wanted = markerNumbers(prose, 'S');
  const sources = new Map<number, ChatWebSource>();
  for (const record of registry.records) {
    for (const provenance of record.provenance) {
      if (
        provenance.kind === 'web' &&
        provenance.sourceNum &&
        wanted.includes(provenance.sourceNum)
      ) {
        sources.set(provenance.sourceNum, {
          title: provenance.title,
          url: provenance.url,
          num: provenance.sourceNum,
          evidenceId: record.id,
        });
      }
    }
  }
  return wanted.flatMap((number) => {
    const source = sources.get(number);
    return source ? [source] : [];
  });
};
