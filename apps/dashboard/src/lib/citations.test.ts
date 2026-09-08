import { expect, test } from 'bun:test';
import {
  collectLinkedSources,
  type LinkedSource,
  rehypeLinkSources,
} from './citations';
import type { ChatWebSource } from './types';

const source = (
  num: number,
  url = `https://example.com/${num}`,
): LinkedSource => ({
  num,
  url,
  title: `Source ${num}`,
});

// Walk helper: runs the plugin over a minimal tree the way react-markdown
// would hand it over (parsed markdown → hast), then renders it back to a
// compact string where a linked marker reads as `[S2](href=...)`.
type LooseNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: LooseNode[];
};

const renderNode = (node: LooseNode): string => {
  if (node.type === 'text') {
    return node.value ?? '';
  }
  if (node.tagName === 'a') {
    return `[${(node.children ?? []).map(renderNode).join('')}](href=${String(
      node.properties?.href,
    )})`;
  }
  return (node.children ?? []).map(renderNode).join('');
};

const runPlugin = (children: LooseNode[], sources: LinkedSource[]) => {
  const tree = { type: 'root', children } as unknown as LooseNode;
  rehypeLinkSources(sources)()(tree as never);
  return tree;
};

const walkText = (value: string, sources: LinkedSource[]): string => {
  const tree = runPlugin([{ type: 'text', value }], sources);
  return renderNode(tree);
};

test('collect keeps only numbered http(s) sources', () => {
  const chatSources: ChatWebSource[] = [
    { num: 1, url: 'https://a.com', title: 'a' },
    { num: 2, url: 'http://b.com', title: 'b' },
    { url: 'https://c.com', title: 'no num' },
    { num: 4, url: 'javascript:alert(1)', title: 'scheme' },
    { num: 5, url: 'https://d.com', title: 'd' },
  ];
  expect(collectLinkedSources(chatSources).map((s) => s.num)).toEqual([
    1, 2, 5,
  ]);
  expect(collectLinkedSources(null)).toEqual([]);
});

test('links a marker whose number names a carried source', () => {
  // The link keeps the marker verbatim as the prose wrote it (annotate,
  // not rewrite); the href is what makes it a citation.
  expect(walkText('per (S2) the answer', [source(2)])).toBe(
    'per [(S2)](href=https://example.com/2) the answer',
  );
  expect(walkText('per [S2] the answer', [source(2)])).toBe(
    'per [[S2]](href=https://example.com/2) the answer',
  );
});

test('a marker with no stored source stays verbatim', () => {
  expect(walkText('per (S3) the answer', [source(2)])).toBe(
    'per (S3) the answer',
  );
  expect(walkText('per (S2) here', [])).toBe('per (S2) here');
});

test('markers inside code and links are skipped', () => {
  const tree = runPlugin(
    [
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [{ type: 'text', value: 'see (S1)' }],
      },
      {
        type: 'element',
        tagName: 'a',
        properties: { href: 'https://x.com' },
        children: [{ type: 'text', value: '(S1) link' }],
      },
    ],
    [source(1)],
  );
  // Code stays verbatim; the pre-existing link is untouched (my renderer
  // shows any `a` as [text](href=...), so untouched reads as unlinked).
  expect(renderNode(tree)).toBe('see (S1)[(S1) link](href=https://x.com)');
});

test('every numbered marker links when all sources are carried', () => {
  const linked = [source(1), source(2), source(12)];
  expect(walkText('(S1) and (S2) and (S12)', linked)).toBe(
    '[(S1)](href=https://example.com/1) and [(S2)](href=https://example.com/2) and [(S12)](href=https://example.com/12)',
  );
});
