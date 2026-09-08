import { useEffect, useState } from 'react';

// A grounded answer can spend 30 to 46 seconds in the model's reasoning pass
// before its first word arrives. The step trace says what is happening; this
// says it is still happening, which is what a frozen line cannot.
export const Elapsed = ({ since }: { since: number }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  // Silent for the first few seconds: a counter on a fast answer is noise.
  if (seconds < 3) {
    return null;
  }
  return <span className="tabular-nums">{seconds}s</span>;
};
