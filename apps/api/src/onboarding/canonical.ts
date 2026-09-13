import { SURFACES, type Surface } from '@refd/core/surfaces';

export const CONFIGURATION_SCHEMA_VERSION = 1;

export interface CanonicalAlias {
  value: string;
  caseSensitive: boolean;
}

export interface CanonicalCompetitor {
  draftId: string;
  name: string;
  domains: string[];
  aliases: CanonicalAlias[];
}

export interface CanonicalPrompt {
  draftId: string;
  text: string;
  category: string;
}

export interface SetupConfiguration {
  schemaVersion: 1;
  workspace: { name: string };
  brand: { name: string; domains: string[]; aliases: CanonicalAlias[] };
  profile: { description: string; summary: string; targetMarket: string };
  competitors: CanonicalCompetitor[];
  prompts: CanonicalPrompt[];
  enabledSurfaces: Surface[];
}

export interface CanonicalizationInput {
  workspaceName: string;
  brandName: string;
  brandDomains: string[];
  brandAliases: { value: string; caseSensitive?: boolean }[];
  description: string;
  summary: string;
  targetMarket: string;
  competitors: {
    draftId: string;
    name: string;
    domains: string[];
    aliases: { value: string; caseSensitive?: boolean }[];
  }[];
  prompts: { draftId: string; text: string; category: string }[];
  enabledSurfaces: Surface[];
}

// Code-unit comparison everywhere: locale-sensitive ordering would make hashes
// deployment-environment dependent.
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const normalizeText = (value: string): string =>
  value.normalize('NFC').replace(/\r\n?/g, '\n');

const canonicalAliases = (
  aliases: { value: string; caseSensitive?: boolean }[],
): CanonicalAlias[] =>
  aliases
    .map((alias) => ({
      value: normalizeText(alias.value),
      caseSensitive: alias.caseSensitive === true,
    }))
    .sort(
      (a, b) =>
        byText(a.value, b.value) ||
        Number(a.caseSensitive) - Number(b.caseSensitive),
    );

const canonicalDomains = (domains: string[]): string[] =>
  [...domains].map(normalizeText).sort(byText);

const canonicalSurfaces = (surfaces: Surface[]): Surface[] =>
  SURFACES.filter((surface) => surfaces.includes(surface));

// Lexicographic key order at every depth and no insignificant whitespace: the
// hash is over exactly these bytes.
export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => byText(a, b),
    );
    return `{${entries
      .map(
        ([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const canonicalizeSetupConfiguration = (
  input: CanonicalizationInput,
): SetupConfiguration => ({
  schemaVersion: 1,
  workspace: { name: normalizeText(input.workspaceName) },
  brand: {
    name: normalizeText(input.brandName),
    domains: canonicalDomains(input.brandDomains),
    aliases: canonicalAliases(input.brandAliases),
  },
  profile: {
    description: normalizeText(input.description),
    summary: normalizeText(input.summary),
    targetMarket: normalizeText(input.targetMarket),
  },
  competitors: [...input.competitors]
    .sort((a, b) => byText(a.draftId, b.draftId))
    .map((competitor) => ({
      draftId: competitor.draftId,
      name: normalizeText(competitor.name),
      domains: canonicalDomains(competitor.domains),
      aliases: canonicalAliases(competitor.aliases),
    })),
  prompts: [...input.prompts]
    .sort((a, b) => byText(a.draftId, b.draftId))
    .map((prompt) => ({
      draftId: prompt.draftId,
      text: normalizeText(prompt.text),
      category: normalizeText(prompt.category),
    })),
  enabledSurfaces: canonicalSurfaces(input.enabledSurfaces),
});
export const canonicalConfigurationBytes = (
  configuration: SetupConfiguration,
): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(
    stableStringify(configuration),
  ) as Uint8Array<ArrayBuffer>;

export const canonicalConfigurationHash = async (
  configuration: SetupConfiguration,
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    canonicalConfigurationBytes(configuration),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};
