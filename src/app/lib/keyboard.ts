import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import { isTypingTarget } from './utils';

interface KeyOptions {
  enabled?: boolean; // mount the listener (default true)
  ignoreWhenTyping?: boolean; // skip when focus is in an editable field (default true)
  bypassInputFields?: boolean; // fire from editable fields, overriding ignoreWhenTyping (default false)
  capture?: boolean; // listen before focused controls handle the event (default false)
  meta?: boolean; // require ⌘/Ctrl; otherwise a bare key (no ⌘/Ctrl/Alt) (default false)
  preventDefault?: boolean; // default false
}

// Fire `handler` when one of `keys` is pressed (case-insensitive on event.key).
// The listener re-subscribes only when `enabled` changes; everything else is read
// live from a ref, so inline handlers/keys never thrash the subscription.
export const useOnKeyPress = (
  keys: string | string[],
  handler: (event: KeyboardEvent) => void,
  options: KeyOptions = {},
) => {
  const {
    enabled = true,
    ignoreWhenTyping = true,
    bypassInputFields = false,
    capture = false,
    meta = false,
    preventDefault = false,
  } = options;
  const ref = useRef({
    keys,
    handler,
    ignoreWhenTyping,
    bypassInputFields,
    meta,
    preventDefault,
  });
  ref.current = {
    keys,
    handler,
    ignoreWhenTyping,
    bypassInputFields,
    meta,
    preventDefault,
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const current = ref.current;
      const hasMeta = event.metaKey || event.ctrlKey;
      if (current.meta ? !hasMeta : hasMeta || event.altKey) {
        return;
      }
      if (
        current.ignoreWhenTyping &&
        !current.bypassInputFields &&
        isTypingTarget(event.target)
      ) {
        return;
      }
      const wanted = Array.isArray(current.keys)
        ? current.keys
        : [current.keys];
      if (!wanted.some((k) => k.toLowerCase() === event.key.toLowerCase())) {
        return;
      }
      if (current.preventDefault) {
        event.preventDefault();
      }
      current.handler(event);
    };
    window.addEventListener('keydown', onKey, capture);
    return () => window.removeEventListener('keydown', onKey, capture);
  }, [capture, enabled]);
};

// Enter on a single-line field: run `handler` instead of the browser default.
// Shift+Enter is left alone so a textarea can still take a newline.
export const onEnterKey =
  (handler: () => void) => (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    handler();
  };

// Enter normally advances only while nothing holds focus. bypassInputFields
// lets an editable field trigger the shortcut, while focused buttons still keep
// ownership of Enter so their click and the advance cannot both fire.
export const useEnterAdvance = (
  handler: () => void,
  enabled = true,
  bypassInputFields = false,
) =>
  useOnKeyPress(
    'Enter',
    () => {
      const el = document.activeElement;
      if (
        el &&
        el !== document.body &&
        !(bypassInputFields && isTypingTarget(el))
      ) {
        return;
      }
      handler();
    },
    { enabled, bypassInputFields },
  );

// Escape steps the wizard back. Unlike Enter it fires from inside fields too —
// Escape types nothing, so "get me out of here" should work without tabbing out.
// An open popover owns Escape first: menus and Select mark their trigger
// aria-expanded, and that attribute still reads true while their own Escape
// handler runs, so the popover closes and the wizard stays put. A second Escape
// then goes back.
export const useEscapeBack = (handler: () => void, enabled = true) =>
  useOnKeyPress(
    'Escape',
    () => {
      if (document.querySelector('[aria-expanded="true"]')) {
        return;
      }
      handler();
    },
    { enabled, bypassInputFields: true },
  );

// Fire the matching handler when `prefix` is pressed, then one of the chord keys
// within `timeoutMs` (e.g. "g" then "o"). Bare keys only; skipped while typing
// unless bypassInputFields is enabled.
export const useChordKeyPress = (
  prefix: string,
  handlers: Record<string, (event: KeyboardEvent) => void>,
  options: {
    enabled?: boolean;
    timeoutMs?: number;
    ignoreWhenTyping?: boolean;
    bypassInputFields?: boolean;
  } = {},
) => {
  const {
    enabled = true,
    timeoutMs = 1500,
    ignoreWhenTyping = true,
    bypassInputFields = false,
  } = options;
  const ref = useRef({
    prefix,
    handlers,
    ignoreWhenTyping,
    bypassInputFields,
  });
  ref.current = {
    prefix,
    handlers,
    ignoreWhenTyping,
    bypassInputFields,
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disarm = () => {
      armed = false;
      clearTimeout(timer);
    };
    const onKey = (event: KeyboardEvent) => {
      const current = ref.current;
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (
        current.ignoreWhenTyping &&
        !current.bypassInputFields &&
        isTypingTarget(event.target)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (armed) {
        const handler = current.handlers[key];
        disarm();
        if (handler) {
          event.preventDefault();
          handler(event);
        }
        return;
      }
      if (key === current.prefix.toLowerCase()) {
        armed = true;
        timer = setTimeout(disarm, timeoutMs);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      disarm();
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled, timeoutMs]);
};
