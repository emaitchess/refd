import type { APIRoute, GetStaticPaths } from 'astro';
import { markdownDocument, markdownResponse } from '../lib/markdown';
import {
  getPublicContent,
  type PublicContentEntry,
} from '../lib/public-content';

interface Props {
  entry: PublicContentEntry;
}

export const getStaticPaths = (async () => {
  const entries = await getPublicContent();
  return entries.map((entry) => ({
    params: { path: entry.path.slice(1) },
    props: { entry },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  markdownResponse(markdownDocument(props.entry));
