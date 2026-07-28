export const oauthReturnPath = (
  search: string,
  origin: string,
): string | null => {
  const value = new URLSearchParams(search).get('next');
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      url.pathname !== '/api/oauth/authorize' ||
      url.hash
    ) {
      return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
};
