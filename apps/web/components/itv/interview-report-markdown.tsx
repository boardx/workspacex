"use client";

import type { ComponentType, JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { interviewMarkdown } from "@repo/contracts";

/**
 * `DIGITAL_REPORT_REQUIRED_HEADINGS` mandates `##` headings in report
 * markdown, which `react-markdown` renders as `<h2>`. The report is always
 * mounted under an `<h2>` title and an `<h3>` section wrapper ("研究发现"),
 * so rendering the generated headings as `<h2>` would place them as
 * document-outline siblings of the report title instead of descendants of
 * the section wrapper. Shift every generated heading down two levels
 * (`##` -> `<h4>`, `###` -> `<h5>`, ...) so screen-reader heading navigation
 * keeps a strictly descending outline.
 */
type HeadingProps = JSX.IntrinsicElements["h1"];
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

const headingComponents: Record<string, ComponentType<HeadingProps>> = Object.fromEntries(
  HEADING_TAGS.map((sourceTag, index) => {
    const shiftedIndex = Math.min(index + 2, HEADING_TAGS.length - 1);
    const Tag = HEADING_TAGS[shiftedIndex]!;
    const Heading = (props: HeadingProps) => {
      switch (Tag) {
        case "h1": return <h1 {...props} />;
        case "h2": return <h2 {...props} />;
        case "h3": return <h3 {...props} />;
        case "h4": return <h4 {...props} />;
        case "h5": return <h5 {...props} />;
        default: return <h6 {...props} />;
      }
    };
    Heading.displayName = `InterviewReportHeading-${sourceTag}`;
    return [sourceTag, Heading];
  }),
);

/** Report markdown is model output, so raw HTML and unsafe URLs are always sanitized. */
export function InterviewReportMarkdown({ markdown, testId, document, longForm = false }: { readonly markdown: string; readonly testId: string; readonly document?: interviewMarkdown.InterviewMarkdownDocument; readonly longForm?: boolean }) {
  const blocks = document ? interviewMarkdown.parseInterviewMarkdown(document).blocks : [];
  const components = document ? Object.fromEntries(HEADING_TAGS.map((Tag) => [Tag,
    ({ node, ...props }: HeadingProps & { node?: { position?: { start: { offset?: number } } } }) => {
      const block = blocks.find((candidate) => candidate.start === node?.position?.start.offset);
      return <Tag {...props} id={block?.headingId} className="scroll-mt-8" />;
    },
  ])) : headingComponents;
  return (
    <div
      data-testid={testId}
      className={`chat-markdown mt-6 leading-7 text-card-foreground ${longForm ? "interview-report-markdown" : "text-sm"}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
