// Validate the post-sign-in return target for the OAuth authorize flow. The
// only accepted target is the API's `/oauth/authorize` endpoint on the
// configured API origin — anything else (open redirect, other endpoints) is
// rejected. Returns an absolute URL so a split deployment can hand off across
// origins; in the same-origin bridge it is the current origin.
export const oauthReturnPath = (
  search: string,
  apiOrigin: string,
): string | null => {
  const value = new URLSearchParams(search).get('next');
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, apiOrigin);
    if (
      url.origin !== apiOrigin ||
      url.pathname !== '/oauth/authorize' ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};
