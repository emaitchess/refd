export interface DomainCheck {
  domain: string;
  // False when DNS/TLS/socket resolution failed outright.
  resolved: boolean;
  // The final reached hop's HTTP status; null when nothing answered.
  status: number | null;
  finalUrl: string | null;
  redirects: string[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_HOPS = 4;

const probe = async (url: string): Promise<Response> =>
  fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });

// Verification for setup entry: whether the domain answers at all, on what
// status, and where any redirect chain lands. A wrong competitor domain
// silently breaks citation matching forever, so the tool exists to catch
// lookalike registrant domains before they are saved.
export const checkDomain = async (input: string): Promise<DomainCheck> => {
  const holder: DomainCheck = {
    domain: input,
    resolved: false,
    status: null,
    finalUrl: null,
    redirects: [],
  };
  let url = `https://${input}/`;
  const wwwUrl = `https://www.${input}/`;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let res: Response;
    try {
      res = await probe(url);
    } catch {
      if (hop > 0) {
        return holder;
      }
      const www: Response | null = await probe(wwwUrl).catch(() => null);
      if (!www) {
        return holder;
      }
      res = www;
      url = wwwUrl;
      if (!REDIRECT_STATUSES.has(res.status)) {
        holder.finalUrl = url;
        holder.status = res.status;
        holder.resolved = true;
        return holder;
      }
    }
    holder.status = res.status;
    holder.resolved = true;
    const location = res.headers.get('location');
    if (!REDIRECT_STATUSES.has(res.status) || hop === MAX_HOPS || !location) {
      holder.finalUrl = url;
      return holder;
    }
    let next: string;
    try {
      next = new URL(location, url).toString();
    } catch {
      holder.finalUrl = url;
      return holder;
    }
    holder.redirects.push(next.split('?')[0] ?? next);
    url = next;
  }
  return holder;
};
