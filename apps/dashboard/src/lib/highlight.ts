import {
  type Alias,
  composeAliases,
  findMentionSpans,
} from '@refd/core/mentions';
import type { DitherColor } from '@/components/dither-kit/palette';

export interface HighlightEntity {
  name: string;
  color: DitherColor;
  domain?: string; // drives the inline favicon; omitted entities render bare
  domains?: string[]; // all owned domains — part of the alias composition
  aliases?: Alias[];
}

export interface EntityMatch {
  start: number;
  end: number;
  entity: number; // index into the entities array
}

// Thin adapter over the shared matcher (packages/core/src/mentions.ts) — the same
// engine the scorer runs, with the same composeAliases, so a highlight appears
// if and only if that entity is scored "mentioned" in this same text.
export const findEntityMatches = (
  text: string,
  entities: HighlightEntity[],
): EntityMatch[] => {
  const matchEntities = entities.map((entity, index) => ({
    id: index,
    aliases: composeAliases(
      entity.name,
      entity.domains ?? (entity.domain ? [entity.domain] : []),
      entity.aliases ?? [],
    ),
  }));
  return findMentionSpans(text, matchEntities).map((span) => ({
    start: span.start,
    end: span.end,
    entity: span.entityId,
  }));
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

// Inside these, a "mention" is markup or a literal, not prose.
const SKIP_TAGS = new Set(['code', 'pre', 'mark']);

// The matched text is kept verbatim rather than swapped for the canonical name:
// this is a scraped answer, and we annotate it, we don't rewrite it.
const markNode = (value: string, entity: HighlightEntity): ElementNode => ({
  type: 'element',
  tagName: 'mark',
  properties: {
    dataColor: entity.color,
    dataEntity: entity.name,
    dataDomain: entity.domain ?? '',
  },
  children: [{ type: 'text', value }],
});

const splitTextNode = (value: string, entities: HighlightEntity[]): Node[] => {
  const matches = findEntityMatches(value, entities);
  if (matches.length === 0) {
    return [{ type: 'text', value }];
  }
  const out: Node[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, match.start) });
    }
    const entity = entities[match.entity];
    if (entity) {
      out.push(markNode(value.slice(match.start, match.end), entity));
    }
    cursor = match.end;
  }
  if (cursor < value.length) {
    out.push({ type: 'text', value: value.slice(cursor) });
  }
  return out;
};

// Wraps entity mentions in <mark> at the text-node level, after the markdown is
// already parsed. Doing it on the AST rather than the source string is what
// keeps it from rewriting link hrefs, code, or markdown syntax itself, and it
// adds no raw-HTML path.
export const rehypeHighlightEntities =
  (entities: HighlightEntity[]) => () => (tree: Node) => {
    if (entities.length === 0) {
      return;
    }
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
          next.push(...splitTextNode((child as TextNode).value, entities));
        } else {
          walk(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
