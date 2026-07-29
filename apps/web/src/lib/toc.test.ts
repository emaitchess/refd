import { describe, expect, test } from 'bun:test';
import { activeTocHeadingId } from './toc';

const headings = [
  { id: 'collect', top: 80 },
  { id: 'score', top: 480 },
  { id: 'audit', top: 920 },
];

describe('activeTocHeadingId', () => {
  test('keeps the table of contents inactive before the article reaches the reading line', () => {
    expect(
      activeTocHeadingId({
        contentTop: 240,
        headings,
        anchor: 120,
        atPageEnd: false,
      }),
    ).toBeNull();
  });

  test('keeps the table of contents inactive before the first section starts', () => {
    expect(
      activeTocHeadingId({
        contentTop: 80,
        headings: headings.map((heading) => ({
          ...heading,
          top: heading.top + 100,
        })),
        anchor: 120,
        atPageEnd: false,
      }),
    ).toBeNull();
  });

  test('returns the last heading that crossed the reading line', () => {
    expect(
      activeTocHeadingId({
        contentTop: -400,
        headings,
        anchor: 120,
        atPageEnd: false,
      }),
    ).toBe('collect');
    expect(
      activeTocHeadingId({
        contentTop: -800,
        headings: headings.map((heading) => ({
          ...heading,
          top: heading.top - 440,
        })),
        anchor: 120,
        atPageEnd: false,
      }),
    ).toBe('score');
  });

  test('returns the final heading at the bottom of a short last section', () => {
    expect(
      activeTocHeadingId({
        contentTop: -800,
        headings,
        anchor: 120,
        atPageEnd: true,
      }),
    ).toBe('audit');
  });
});
