// Agent-written chat prose must not carry em or en dashes (the UI copy rule);
// the model cannot be trusted to comply, so the replacement is mechanical:
// an em dash recasts as a comma (surrounding spaces are consumed), an en dash
// stays a hyphen so numeric ranges like 2–3 survive.
export const normalizeDashes = (text: string): string =>
  text
    .replace(/[ \t]*—[ \t]*/g, ', ')
    .replace(/–/g, '-')
    .replace(/[ \t]+,/g, ',')
    .replace(/, *,/g, ',');
