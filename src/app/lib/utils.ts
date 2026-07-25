import { type ClassValue, clsx } from 'clsx';
import type { ClipboardEvent } from 'react';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// Reduce a pasted value (URL, email, host) to a bare domain — mirrors the server
// domainField: strips scheme, credentials, path/query/fragment, port, a leading
// www., and trailing dots.
export const domainFromUrl = (raw: string): string => {
  let s = raw.trim().toLowerCase();
  const scheme = s.indexOf('://');
  if (scheme > 0) {
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

// onPaste handler: rewrite pasted text to bare domain(s) and splice it into the
// input at the caret. multi=true handles comma/space-separated lists.
export const handleDomainPaste = (
  event: ClipboardEvent<HTMLInputElement>,
  current: string,
  setValue: (value: string) => void,
  multi = false,
): void => {
  const pasted = event.clipboardData.getData('text');
  if (!pasted) {
    return;
  }
  event.preventDefault();
  const input = event.currentTarget;
  const start = input.selectionStart ?? current.length;
  const end = input.selectionEnd ?? current.length;
  const cleaned = multi
    ? pasted
        .split(/[\s,]+/)
        .map(domainFromUrl)
        .filter(Boolean)
        .join(', ')
    : domainFromUrl(pasted);
  setValue(current.slice(0, start) + cleaned + current.slice(end));
};

// True when the event target is an editable field — bare-key shortcuts skip these.
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
};
