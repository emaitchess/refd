import { expect, test } from 'bun:test';
import { composeAliases, findMentions } from '../../shared/mentions';
import { findEntityMatches, type HighlightEntity } from './highlight';

const entity = (name: string): HighlightEntity => ({ name, color: 'green' });
const matches = (text: string, ...names: string[]) =>
  findEntityMatches(text, names.map(entity));
const marked = (text: string, ...names: string[]) =>
  matches(text, ...names).map((m) => text.slice(m.start, m.end));

// The contract that matters: a highlight appears exactly when the scorer
// counts the entity as mentioned in that same text. Both sides now run the
// shared matcher — this guards the adapter wiring (name/domains/aliases →
// composeAliases) against drifting from what the scorer composes.
const PARITY_CASES: [string, string][] = [
  ['Notion is great', 'Notion'],
  ['notion is great', 'Notion'],
  ['Use Notion.', 'Notion'],
  ['(Notion)', 'Notion'],
  ['Notional', 'Notion'],
  ['xNotion', 'Notion'],
  ['Notion2', 'Notion'],
  ['Notion-like', 'Notion'],
  ['nothing here', 'Notion'],
  ['', 'Notion'],
  ['C++ is fast', 'C++'],
  ['Yahoo! News', 'Yahoo!'],
  ['A.I. tools', 'A.I.'],
  ['Notion Notion', 'Notion'],
  ['stripe.com is the site', 'stripe'],
];

test('highlight agrees with the shared matcher on every case', () => {
  for (const [text, name] of PARITY_CASES) {
    const scored = findMentions(text, [
      { id: 0, aliases: composeAliases(name, []) },
    ])[0]?.mentioned;
    const highlighted = matches(text, name).length > 0;
    expect(`${text} / ${name} -> ${highlighted}`).toBe(
      `${text} / ${name} -> ${scored}`,
    );
  }
});

test('domain entries highlight like the scorer scores them', () => {
  const withDomain: HighlightEntity = {
    name: 'Ahrefs',
    color: 'green',
    domains: ['ahrefs.com'],
  };
  expect(
    findEntityMatches('just visit ahrefs.com today', [withDomain]),
  ).toHaveLength(1);
});

test('finds every occurrence, preserving answer casing', () => {
  expect(marked('NOTION and notion', 'Notion')).toEqual(['NOTION', 'notion']);
  expect(marked('Notion Notion', 'Notion')).toEqual(['Notion', 'Notion']);
});

test('longest entity wins on overlapping names', () => {
  expect(
    marked('Google Cloud is a platform', 'Google', 'Google Cloud'),
  ).toEqual(['Google Cloud']);
  expect(marked('Google and Google Cloud', 'Google', 'Google Cloud')).toEqual([
    'Google',
    'Google Cloud',
  ]);
});

test('ranges map back to the right entity', () => {
  const text = 'Notion beats Stripe';
  const found = findEntityMatches(text, [entity('Notion'), entity('Stripe')]);
  expect(found.map((m) => m.entity)).toEqual([0, 1]);
});

test('empty and whitespace names are ignored', () => {
  expect(matches('anything at all', '', '   ')).toEqual([]);
});
