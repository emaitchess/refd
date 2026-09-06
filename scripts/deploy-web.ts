import { fileURLToPath } from 'node:url';
import {
  INDEXABLE_PUBLIC_PATHS,
  PUBLIC_SITE_ORIGIN,
} from '@refd/core/public-pages';
import { indexNowUrls, submitIndexNow } from './submit-indexnow';

const WEB_DIRECTORY = fileURLToPath(new URL('../apps/web', import.meta.url));
const SITEMAP_URL = `${PUBLIC_SITE_ORIGIN}/sitemap.xml`;

const decodeXml = (value: string): string =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");

export const sitemapUrls = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
    decodeXml(match[1] ?? ''),
  );

export const addedUrls = (
  currentUrls: readonly string[],
  deployedUrls: readonly string[],
): string[] => {
  const deployed = new Set(indexNowUrls(deployedUrls));
  return indexNowUrls(currentUrls).filter((url) => !deployed.has(url));
};

const liveSitemapUrls = async (): Promise<string[]> => {
  try {
    const response = await fetch(SITEMAP_URL, {
      headers: { Accept: 'application/xml' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return indexNowUrls(sitemapUrls(await response.text()));
  } catch (error) {
    console.warn(
      `Could not read ${SITEMAP_URL}; all canonical URLs will be submitted after deployment.`,
      error,
    );
    return [];
  }
};

const main = async () => {
  const dryRun = Bun.argv.includes('--dry-run');
  const deployedUrls = await liveSitemapUrls();
  const currentUrls = indexNowUrls(INDEXABLE_PUBLIC_PATHS);
  const urlsToSubmit = addedUrls(currentUrls, deployedUrls);
  const command = ['wrangler', 'deploy', ...(dryRun ? ['--dry-run'] : [])];
  const deployment = Bun.spawn(command, {
    cwd: WEB_DIRECTORY,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await deployment.exited;

  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }
  if (urlsToSubmit.length === 0) {
    console.log('No new canonical URLs to submit to IndexNow.');
    return;
  }

  await submitIndexNow(urlsToSubmit, dryRun);
};

if (import.meta.main) {
  await main();
}
