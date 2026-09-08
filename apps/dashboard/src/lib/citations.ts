import type { ChatWebSource } from '@/lib/types';

export interface LinkedSource {
  num: number;
  url: string;
  title: string;
}

// The scorer contract for this file: only sources that pass the http(s) scheme
// check are ever handed in, so a marker can only link to a real web source.
export const collectLinkedSources = (
  sources: ChatWebSource[] | null,
): LinkedSource[] => {
  const out: LinkedSource[] = [];
  if (!sources) {
    return out;
  }
  for (const source of sources) {
    if (typeof source.num !== 'number' || !Number.isFinite(source.num)) {
      continue;
    }
    if (!/^https?:\/\//i.test(source.url)) {
      continue;
    }
    out.push({ num: source.num, url: source.url, title: source.title });
  }
  return out;
};

// Minimal hast shapes — enough to walk what react-markdown hands us.
interface TextNode {
  type: 'text';
  value: string;
}
interface ElementNode {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: Node[];
}
type Node = TextNode | ElementNode | { type: string; children?: Node[] };

const hasChildren = (node: Node): node is { type: string; children: Node[] } =>
  Array.isArray((node as { children?: unknown }).children);

// Inside these, an "S-marker" is a literal, not a citation.
const SKIP_TAGS = new Set(['code', 'pre', 'a', 'mark']);

// The prose cites like (S2); the bracketed form covers minor model drift.
const MARKER = /([[(])(S)(\d{1,2})([\])])/g;

interface MarkerSpan {
  start: number;
  end: number;
  num: number;
}

const findMarkerSpans = (text: string, byNum: Map<number, LinkedSource>) => {
  const spans: MarkerSpan[] = [];
  for (const match of text.matchAll(MARKER)) {
    const num = Number(match[3]);
    if (!byNum.has(num)) {
      continue;
    }
    const index = match.index ?? 0;
    spans.push({ start: index, end: index + match[0].length, num });
  }
  return spans;
};

const refNode = (value: string, source: LinkedSource): ElementNode => ({
  type: 'element',
  tagName: 'a',
  properties: {
    href: source.url,
    title: source.title,
    target: '_blank',
    rel: 'noreferrer nofollow',
    className: ['md-source-ref'],
    dataSource: source.num,
  },
  children: [{ type: 'text', value }],
});

const splitTextNode = (value: string, byNum: Map<number, LinkedSource>) => {
  const spans = findMarkerSpans(value, byNum);
  if (spans.length === 0) {
    return [{ type: 'text', value }] as Node[];
  }
  const out: Node[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, span.start) });
    }
    const source = byNum.get(span.num);
    if (source) {
      out.push(refNode(value.slice(span.start, span.end), source));
    }
    cursor = span.end;
  }
  if (cursor < value.length) {
    out.push({ type: 'text', value: value.slice(cursor) });
  }
  return out;
};

// Links (S2)-style citation markers in the prose to the stored web sources, at
// the text-node level of the parsed markdown. The number must name a source
// this message actually carries; a marker with no stored source stays verbatim
// text, so the link can never name a thing the answer does not show.
export const rehypeLinkSources =
  (sources: LinkedSource[]) => () => (tree: Node) => {
    if (sources.length === 0) {
      return;
    }
    const byNum = new Map(sources.map((source) => [source.num, source]));
    const walk = (node: Node) => {
      if (!hasChildren(node)) {
        return;
      }
      if (
        node.type === 'element' &&
        SKIP_TAGS.has((node as ElementNode).tagName)
      ) {
        return;
      }
      const next: Node[] = [];
      for (const child of node.children) {
        if (child.type === 'text') {
          next.push(...splitTextNode((child as TextNode).value, byNum));
        } else {
          walk(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
