/** Shared model citation grammar. Numeric footnotes are deliberately not guessed. */
export function mapGuidedResearchCitations(text: string, replace: (id: string) => string, incomplete?: (fragment: string) => string): string {
  const code = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))|(`+)[^\n]*?\2/gm;
  const citation = /\[\[(?:source:)?([^\[\]\r\n]+)\]\]|(?<!\[)\[((?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})|(?:S\d+))\](?!\])|(\[\[[^\r\n]*)/gi;
  const transform = (value: string) => value.replace(citation, (_match, double: string | undefined, single: string | undefined, fragment: string | undefined) => fragment !== undefined
    ? incomplete ? incomplete(fragment) : fragment
    : replace((double ?? single ?? "").trim()));
  let cursor = 0; let output = "";
  for (const match of text.matchAll(code)) {
    output += transform(text.slice(cursor, match.index)) + match[0]; cursor = match.index! + match[0].length;
  }
  return output + transform(text.slice(cursor));
}
