import { copyFile, cp, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateSitemap, publicPathFromHtml } from './sitemap';

const clientDir = path.resolve(import.meta.dirname, '../dist/client');
const siteDir = path.resolve(import.meta.dirname, '../dist/site');

const htmlFiles = async (directory: string, prefix = ''): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) {
        return htmlFiles(path.join(directory, entry.name), relative);
      }
      return entry.isFile() && entry.name.endsWith('.html') ? [relative] : [];
    }),
  );
  return files.flat();
};

const assembleStatic = async () => {
  await copyFile(
    path.join(clientDir, 'index.html'),
    path.join(clientDir, 'app-shell.html'),
  );
  await cp(siteDir, clientDir, { recursive: true, force: true });

  const publicPaths = (await htmlFiles(siteDir))
    .map(publicPathFromHtml)
    .filter((publicPath): publicPath is string => publicPath !== null)
    .sort();
  await writeFile(
    path.join(clientDir, 'sitemap.xml'),
    generateSitemap(publicPaths),
    'utf8',
  );
};

await assembleStatic();
