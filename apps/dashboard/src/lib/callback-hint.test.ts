import { expect, test } from 'bun:test';
import { callbackHint } from './callback-hint';

test('loopback http callbacks read as local agent', () => {
  expect(callbackHint('http://127.0.0.1:19876')).toBe('local agent');
  expect(callbackHint('http://localhost:3000')).toBe('local agent');
  expect(callbackHint('http://[::1]:8787')).toBe('local agent');
});

test('remote callbacks stay plain', () => {
  expect(callbackHint('https://claude.ai')).toBeNull();
  expect(callbackHint('http://10.0.0.1:9000')).toBeNull();
});

test('app-specific schemes read as custom scheme', () => {
  expect(callbackHint('vscode://refd.callback')).toBe('custom scheme');
});

test('missing targets have no hint', () => {
  expect(callbackHint(null)).toBeNull();
  expect(callbackHint(undefined)).toBeNull();
  expect(callbackHint('')).toBeNull();
});
