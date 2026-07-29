interface HeadingPosition {
  id: string;
  top: number;
}

interface ActiveTocHeadingOptions {
  contentTop: number;
  headings: HeadingPosition[];
  anchor: number;
  atPageEnd: boolean;
}

export const activeTocHeadingId = ({
  contentTop,
  headings,
  anchor,
  atPageEnd,
}: ActiveTocHeadingOptions): string | null => {
  if (contentTop > anchor) {
    return null;
  }
  if (atPageEnd) {
    return headings.at(-1)?.id ?? null;
  }

  let activeId: string | null = null;
  for (const heading of headings) {
    if (heading.top > anchor) {
      break;
    }
    activeId = heading.id;
  }
  return activeId;
};
