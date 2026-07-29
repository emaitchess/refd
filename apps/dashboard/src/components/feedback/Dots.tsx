// Animated "working" indicator: three dots pulsing in a wave. Fixed width (all
// three always rendered), so it never shifts adjacent text.
export const Dots = () => (
  <span className="loading-dots" aria-hidden>
    <span>.</span>
    <span>.</span>
    <span>.</span>
  </span>
);
