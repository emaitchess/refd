const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' || host === '[::1]' || host.startsWith('127.');

export const callbackHint = (
  target: string | null | undefined,
): string | null => {
  if (!target) {
    return null;
  }
  if (target.startsWith('https://')) {
    return null;
  }
  if (target.startsWith('http://')) {
    try {
      return isLoopbackHost(new URL(target).hostname) ? 'local agent' : null;
    } catch {
      return null;
    }
  }
  return 'custom scheme';
};
