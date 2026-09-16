import { expect, test } from 'bun:test';
import { switchDestination } from './nav';

test('drops a prefixed chat id and rewrites the workspace prefix', () => {
  expect(switchDestination('/w/1/home/5', 2)).toBe('/w/2/home');
});

test('drops a bare chat id', () => {
  expect(switchDestination('/home/5', 2)).toBe('/home');
});

test('drops a run id', () => {
  expect(switchDestination('/runs/61', 2)).toBe('/runs');
});

test('sends a setup report back to onboarding', () => {
  expect(switchDestination('/w/1/onboarding/report/7', 2)).toBe(
    '/w/2/onboarding',
  );
  expect(switchDestination('/onboarding/report/7', 2)).toBe('/onboarding');
});

test('keeps an idless prefixed page and rewrites the prefix', () => {
  expect(switchDestination('/w/1/home', 2)).toBe('/w/2/home');
  expect(switchDestination('/w/1/onboarding', 2)).toBe('/w/2/onboarding');
});

test('keeps idless pages unchanged', () => {
  expect(switchDestination('/overview', 2)).toBe('/overview');
  expect(switchDestination('/prompts', 2)).toBe('/prompts');
  expect(switchDestination('/help/glossary', 2)).toBe('/help/glossary');
});

test('handles the workspace root and site root', () => {
  expect(switchDestination('/w/1', 2)).toBe('/w/2');
  expect(switchDestination('/', 2)).toBe('/');
});

test('only drops trailing numeric segments', () => {
  expect(switchDestination('/runs/61/results', 2)).toBe('/runs/61/results');
  expect(switchDestination('/w/1/home/abc', 2)).toBe('/w/2/home/abc');
});
