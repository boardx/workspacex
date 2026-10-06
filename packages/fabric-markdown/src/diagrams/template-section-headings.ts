/** Recognize an unambiguous template section written without Markdown heading syntax. */
export function normalizeTemplateSectionHeading(
  line: string,
  nextNonemptyLine: string | undefined,
  resolveSection: (name: string) => string | null,
  isField: (name: string) => boolean,
): { text: string; from: string; to: string } | null {
  const withColon = /^\s*([^#\-*\s][^:：\n]{0,60})\s*[:：][ \t]*(.*)$/.exec(line);
  const bare = withColon ?? /^\s*([^#\-*\s][^:：\n]{0,60})\s*$/.exec(line);
  if (!bare) return null;
  const name = bare[1]!.trim();
  const content = withColon ? bare[2]!.trim() : '';
  if (isField(name)) return null;
  if (!content && !(nextNonemptyLine && /^\s*[-*]\s+\S/.test(nextNonemptyLine))) return null;
  const section = resolveSection(name);
  if (section === null) return null;
  const heading = `## ${section}`;
  return { text: content ? `${heading}\n- ${content}` : heading, from: name, to: heading };
}
