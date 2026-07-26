import { writeFile } from 'node:fs/promises';
import { generateSitemap } from './sitemap';

const outputUrl = new URL('../public/sitemap.xml', import.meta.url);

await writeFile(outputUrl, generateSitemap(), 'utf8');
