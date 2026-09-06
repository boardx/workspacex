/** Read only string values at known report paths from an unfinished JSON document.
 * Never turn model text into HTML, links, or a validated report. */
export function researchReportPreview(text: string): { title: string; summary: string; sections: { sectionId: string; body: string }[] } {
  text = text.replace(/^\s*```(?:json)?\s*/i, "");
  let at = 0;
  const whitespace = () => { while (/\s/.test(text[at] ?? "") && at < text.length) at++; };
  function string(): string {
    at++;
    let value = "";
    while (at < text.length) {
      const char = text[at++]!;
      if (char === '"') break;
      if (char !== "\\") { value += char; continue; }
      const escape = text[at++];
      if (escape === "u") {
        const hex = text.slice(at, at + 4);
        if (!/^[a-f\d]{4}$/i.test(hex)) break;
        value += String.fromCharCode(parseInt(hex, 16)); at += 4;
      } else {
        const decoded: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (!escape || !(escape in decoded)) break;
        value += decoded[escape];
      }
    }
    // Hold a split surrogate until its matching low surrogate arrives.
    return value.replace(/[\uD800-\uDBFF]$/, "");
  }
  function value(depth = 0): unknown {
    whitespace(); if (depth > 12) return undefined;
    if (text[at] === '"') return string();
    if (text[at] === "{") {
      at++; const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      while (at < text.length) {
        whitespace(); if (text[at] !== '"') break;
        const key = string(); whitespace(); if (text[at++] !== ":") break;
        result[key] = value(depth + 1); whitespace(); if (text[at++] !== ",") break;
      }
      return result;
    }
    if (text[at] === "[") {
      at++; const result: unknown[] = [];
      while (at < text.length) {
        whitespace(); if (text[at] === "]") { at++; break; }
        const before = at; result.push(value(depth + 1)); if (at === before) break;
        whitespace(); if (text[at++] !== ",") break;
      }
      return result;
    }
    while (at < text.length && !/[\s,\]}]/.test(text[at]!)) at++;
    return undefined;
  }
  const parsed = value();
  const object = (item: unknown): Record<string, unknown> => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
  const report = object(parsed);
  const field = (item: unknown) => typeof item === "string" ? item : "";
  return { title: field(report.title), summary: field(report.summary), sections: Array.isArray(report.sections) ? report.sections.map((item) => { const section = object(item); return { sectionId: field(section.sectionId), body: field(section.body) }; }) : [] };
}
