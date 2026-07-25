import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

// One-shot URL flag. The command palette can't reach a page's local modal state,
// so it navigates with `?new=1` and the page opens its own dialog on arrival.
// The flag is consumed immediately (replace, not push) so a reload or a back-nav
// doesn't reopen the dialog, and the address bar stays clean.
export const useParamFlag = (name: string, onFlag: () => void) => {
  const [params, setParams] = useSearchParams();
  const present = params.get(name) !== null;
  // Read through a ref: callers pass inline arrows, and depending on the
  // callback identity would re-fire the effect on every render.
  const handler = useRef(onFlag);
  handler.current = onFlag;

  useEffect(() => {
    if (!present) {
      return;
    }
    handler.current();
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(name);
        return next;
      },
      { replace: true },
    );
  }, [present, name, setParams]);
};
