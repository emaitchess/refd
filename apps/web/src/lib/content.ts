export type ContentCollection = 'pages' | 'docs' | 'blog';

export const contentPath = (
  collection: ContentCollection,
  id: string,
): string => (collection === 'pages' ? `/${id}` : `/${collection}/${id}`);

export const formatContentDate = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);

export const byPublishedDate = <
  T extends { data: { publishedAt: Date; order: number } },
>(
  left: T,
  right: T,
): number =>
  left.data.order - right.data.order ||
  right.data.publishedAt.getTime() - left.data.publishedAt.getTime();

export const isPublished = <T extends { data: { draft: boolean } }>(
  entry: T,
): boolean => !entry.data.draft;
