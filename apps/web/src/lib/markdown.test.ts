import { describe, expect, test } from 'bun:test';
import { markdownDocument, markdownIndexDocument } from './markdown';

describe('markdownDocument', () => {
  test('returns a title, short answer, and source Markdown without frontmatter', () => {
    expect(
      markdownDocument({
        title: 'How measurement works',
        answer: 'Every aggregate stays linked to its source answer.',
        body: '\nIntro copy.\n\n## Collect\n\nRun each prompt.\n\n',
      }),
    ).toBe(
      '# How measurement works\n\n> Every aggregate stays linked to its source answer.\n\nIntro copy.\n\n## Collect\n\nRun each prompt.\n',
    );
  });

  test('renders populated and empty index sections as Markdown', () => {
    expect(
      markdownIndexDocument({
        title: 'Documentation',
        introduction: 'Learn how the system works.',
        sections: [
          {
            title: 'Guides',
            entries: [
              {
                title: 'Getting started',
                description: 'Create the first workspace.',
                href: '/docs/getting-started.md',
              },
            ],
          },
          {
            title: 'Research',
            entries: [],
            empty: 'The first research note is in preparation.',
          },
        ],
      }),
    ).toBe(
      '# Documentation\n\nLearn how the system works.\n\n## Guides\n\n- [Getting started](/docs/getting-started.md): Create the first workspace.\n\n## Research\n\nThe first research note is in preparation.\n',
    );
  });
});
