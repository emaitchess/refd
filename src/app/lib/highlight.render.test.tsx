import { expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type HighlightEntity, rehypeHighlightEntities } from '@/lib/highlight';

// Covers the wiring the unit tests can't: that the plugin's nodes survive
// react-markdown and arrive at the `mark` component with their properties, and
// that highlighting never damages the surrounding markdown.
const ENTITIES: HighlightEntity[] = [
  { name: 'Notion', color: 'green', domain: 'notion.so' },
  { name: 'Stripe', color: 'purple', domain: 'stripe.com' },
];

const render = (md: string) =>
  renderToStaticMarkup(
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlightEntities(ENTITIES)]}
      components={{
        // Mirror of ResultPane's EntityMark, minus styling.
        mark: ({
          node,
          children,
        }: {
          node?: { properties?: Record<string, unknown> };
          children?: ReactNode;
        }) => (
          <mark
            data-color={String(node?.properties?.dataColor ?? '')}
            data-domain={String(node?.properties?.dataDomain ?? '')}
          >
            {children}
          </mark>
        ),
      }}
    >
      {md}
    </Markdown>,
  );

test('wraps a mention and carries colour + domain through to the component', () => {
  const html = render('Notion is great.');
  expect(html).toContain(
    '<mark data-color="green" data-domain="notion.so">Notion</mark>',
  );
});

test('each entity keeps its own colour', () => {
  const html = render('Notion beats Stripe.');
  expect(html).toContain('data-color="green"');
  expect(html).toContain('data-color="purple"');
});

test('does not touch link hrefs', () => {
  const html = render('[Notion docs](https://notion.so/help)');
  expect(html).toContain('href="https://notion.so/help"');
  expect(html).toContain('<mark'); // link *text* still highlights
});

test('leaves code spans and fences alone', () => {
  expect(render('`Notion`')).not.toContain('<mark');
  expect(render('```\nNotion\n```')).not.toContain('<mark');
});

test('survives markdown emphasis around the name', () => {
  expect(render('**Notion** rocks')).toContain('<mark');
});

test('no mention, no marks', () => {
  expect(render('Nothing to see.')).not.toContain('<mark');
});

test('markdown structure is preserved', () => {
  const html = render('- Notion\n- Stripe');
  expect(html).toContain('<ul>');
  expect(html).toContain('<li>');
  expect((html.match(/<mark/g) ?? []).length).toBe(2);
});
