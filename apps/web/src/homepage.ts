type FetchAsset = (request: Request) => Promise<Response>;

export const acceptsMarkdown = (accept: string | null): boolean => {
  if (!accept) {
    return false;
  }
  return accept.split(',').some((entry) => {
    const [mediaType = '', ...parameters] = entry.split(';');
    if (mediaType.trim().toLowerCase() !== 'text/markdown') {
      return false;
    }
    const quality = parameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith('q='));
    if (!quality) {
      return true;
    }
    const value = Number(quality.slice(2));
    return Number.isFinite(value) && value > 0;
  });
};

const withRepresentationHeaders = (
  response: Response,
  contentType?: string,
): Response => {
  const headers = new Headers(response.headers);
  const vary = headers.get('Vary');
  const variesByAccept =
    vary === '*' ||
    vary?.split(',').some((header) => header.trim().toLowerCase() === 'accept');
  if (!variesByAccept) {
    headers.set('Vary', vary ? `${vary}, Accept` : 'Accept');
  }
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const handleHomepage = async (
  request: Request,
  fetchAsset: FetchAsset,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (
    url.pathname !== '/' ||
    (request.method !== 'GET' && request.method !== 'HEAD')
  ) {
    return null;
  }
  const markdown = acceptsMarkdown(request.headers.get('Accept'));
  const assetRequest = markdown
    ? new Request(new URL('/index.md', request.url), request)
    : request;
  const response = await fetchAsset(assetRequest);
  return withRepresentationHeaders(
    response,
    markdown ? 'text/markdown; charset=utf-8' : undefined,
  );
};
