import validator from 'validator';
import { z } from 'zod';

const NL = String.fromCharCode(10);

// Invisible / directional format characters (zero-width, bidi overrides + isolates,
// BOM). These enable homoglyph and right-to-left spoofing, so they are stripped
// from all user text.
const isFormatChar = (code: number): boolean =>
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2060 && code <= 0x2064) ||
  (code >= 0x2066 && code <= 0x206f) ||
  code === 0xfeff;

// C0 and C1 control characters.
const isControlChar = (code: number): boolean =>
  code <= 0x1f || (code >= 0x7f && code <= 0x9f);

// NFC-normalize, drop format chars, and turn control chars into spaces. The line
// feed survives as a newline only for multi-line fields (keepNewline).
const scrub = (s: string, keepNewline: boolean): string => {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0;
    if (isFormatChar(code)) {
      continue;
    }
    if (code === 0x0a) {
      out += keepNewline ? NL : ' ';
    } else if (isControlChar(code)) {
      out += ' ';
    } else {
      out += ch;
    }
  }
  return out;
};

// Collapse runs of spaces and trim; split/join avoids whitespace-class escapes.
const collapseSpaces = (s: string): string =>
  s.split(' ').filter(Boolean).join(' ');

// One-line field (names, tags): all whitespace becomes single spaces, then trimmed.
const cleanLine = (s: string): string => collapseSpaces(scrub(s, false));

// Multi-line field (prompts): keep newlines, tidy each line, cap blank-line runs.
const cleanBlock = (s: string): string => {
  const lines = scrub(s, true).split(NL).map(collapseSpaces);
  const out: string[] = [];
  for (const line of lines) {
    if (line === '' && out[out.length - 1] === '') {
      continue;
    }
    out.push(line);
  }
  while (out.length && out[0] === '') {
    out.shift();
  }
  while (out.length && out[out.length - 1] === '') {
    out.pop();
  }
  return out.join(NL);
};

// Reduce a pasted value to a bare domain: drop scheme, credentials, path, port,
// trailing dots, and a leading www. — the www. strip keeps entity domains
// consistent with the citation host normalization in scoring (extractDomain),
// which also drops www.; a www.-prefixed entity domain would never match.
const hostFromInput = (raw: string): string => {
  let s = scrub(raw, false).trim().toLowerCase();
  const scheme = s.indexOf('://');
  if (scheme > 0 && /^[a-z][a-z0-9+.-]*$/.test(s.slice(0, scheme))) {
    try {
      s = new URL(s).hostname;
    } catch {
      s = s.slice(scheme + 3);
    }
  }
  const at = s.lastIndexOf('@');
  if (at >= 0) {
    s = s.slice(at + 1);
  }
  for (const sep of ['/', '?', '#', ':']) {
    s = s.split(sep)[0] ?? s;
  }
  if (s.startsWith('www.')) {
    s = s.slice(4);
  }
  while (s.endsWith('.')) {
    s = s.slice(0, -1);
  }
  return s;
};

/** Single-line text: NFC, no invisible/control chars, collapsed whitespace, length-bounded. */
export const singleLineText = (min: number, max: number) =>
  z.string().transform(cleanLine).pipe(z.string().min(min).max(max));

/** Multi-line text (prompts): keeps newlines, strips other controls, length-bounded. */
export const multiLineText = (min: number, max: number) =>
  z.string().transform(cleanBlock).pipe(z.string().min(min).max(max));

/** Email: trimmed, lowercased, validated with validator.isEmail. */
export const emailField = (max = 254) =>
  z
    .string()
    .transform((s) => scrub(s, false).trim().toLowerCase())
    .pipe(
      z.string().max(max).refine(validator.isEmail, 'invalid email address'),
    );

/** Apex/host domain: URL-stripped, lowercased, validated as an FQDN. */
export const domainField = () =>
  z
    .string()
    .transform(hostFromInput)
    .pipe(
      z
        .string()
        .min(3)
        .max(253)
        .refine(
          (s) =>
            validator.isFQDN(s, {
              require_tld: true,
              allow_underscores: false,
            }),
          'apex domain only, e.g. example.com',
        ),
    );
