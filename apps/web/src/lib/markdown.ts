interface MarkdownDocumentOptions {
  title: string;
  answer: string;
  body: string;
}

interface MarkdownIndexEntry {
  title: string;
  description: string;
  href: string;
}

interface MarkdownIndexSection {
  title: string;
  entries: MarkdownIndexEntry[];
  empty?: string;
}

interface MarkdownIndexOptions {
  title: string;
  introduction: string;
  sections: MarkdownIndexSection[];
}

export const markdownDocument = ({
  title,
  answer,
  body,
}: MarkdownDocumentOptions): string =>
  `# ${title}\n\n> ${answer}\n\n${body.trim()}\n`;

export const markdownIndexDocument = ({
  title,
  introduction,
  sections,
}: MarkdownIndexOptions): string => {
  const renderedSections = sections.map((section) => {
    const entries =
      section.entries.length > 0
        ? section.entries
            .map(
              (entry) =>
                `- [${entry.title}](${entry.href}): ${entry.description}`,
            )
            .join('\n')
        : (section.empty ?? '');
    return `## ${section.title}\n\n${entries}`;
  });

  return `# ${title}\n\n${introduction}\n\n${renderedSections.join('\n\n')}\n`;
};

export const markdownResponse = (body: string): Response =>
  new Response(body, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
