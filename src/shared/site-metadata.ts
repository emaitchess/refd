import { z } from 'zod';

const compactText = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().replaceAll(/\s+/g, ' ').slice(0, max))
    .catch('');

const isHttpUrl = (value: string): boolean => {
  if (!value) {
    return true;
  }
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

export const siteMetadataSchema = z.object({
  title: compactText(240),
  description: compactText(600),
  imageUrl: z
    .string()
    .transform((value) => value.trim().slice(0, 2048))
    .pipe(z.string().refine(isHttpUrl))
    .catch(''),
});

export type SiteMetadata = z.infer<typeof siteMetadataSchema>;
