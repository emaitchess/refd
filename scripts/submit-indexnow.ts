import {
  INDEXABLE_PUBLIC_PATHS,
  PUBLIC_SITE_ORIGIN,
} from '@refd/core/public-pages';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const INDEXNOW_KEY = 'cbc77498933a4e159b2ab1c9a6d2efbc';
const INDEXNOW_KEY_PATH = new URL(
  `../apps/web/public/${INDEXNOW_KEY}.txt`,
  import.meta.url,
);
const INDEXNOW_KEY_LOCATION = `${PUBLIC_SITE_ORIGIN}/${INDEXNOW_KEY}.txt`;

const usage =
  "Usage: bun run --filter '@refd/web' indexnow -- [--dry-run] (--all | /changed-path ...)";

export const indexNowUrls = (inputs: readonly string[]): string[] => {
  const urls = inputs.map((input) => new URL(input, PUBLIC_SITE_ORIGIN));

  for (const url of urls) {
    if (url.origin !== PUBLIC_SITE_ORIGIN) {
      throw new Error(`IndexNow URL must belong to refd.ai: ${url.href}`);
    }
    if (url.hash) {
      throw new Error(`IndexNow URL must not contain a fragment: ${url.href}`);
    }
  }

  return [...new Set(urls.map((url) => url.href))];
};

export const submitIndexNow = async (
  urlList: readonly string[],
  dryRun = false,
) => {
  const urls = indexNowUrls(urlList);
  const hostedKey = (await Bun.file(INDEXNOW_KEY_PATH).text()).trim();

  if (hostedKey !== INDEXNOW_KEY) {
    throw new Error('The IndexNow key file does not match its filename.');
  }

  if (dryRun) {
    console.log(`Would submit ${urls.length} URL(s) to IndexNow.`);
    return;
  }

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(PUBLIC_SITE_ORIGIN).host,
      key: INDEXNOW_KEY,
      keyLocation: INDEXNOW_KEY_LOCATION,
      urlList: urls,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `IndexNow rejected the submission (${response.status})${detail ? `: ${detail}` : '.'}`,
    );
  }

  console.log(`IndexNow accepted ${urls.length} URL(s) (${response.status}).`);
};

const main = async () => {
  const args = Bun.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const inputs = args.filter((arg) => arg !== '--dry-run');

  if (
    inputs.length === 0 ||
    (inputs.includes('--all') && inputs.length !== 1)
  ) {
    throw new Error(usage);
  }

  await submitIndexNow(
    inputs[0] === '--all' ? INDEXABLE_PUBLIC_PATHS : inputs,
    dryRun,
  );
};

if (import.meta.main) {
  await main();
}
