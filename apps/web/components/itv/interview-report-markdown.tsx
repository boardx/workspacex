"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/** Report markdown is model output, so raw HTML and unsafe URLs are always sanitized. */
export function InterviewReportMarkdown({ markdown, testId }: { readonly markdown: string; readonly testId: string }) {
  return (
    <div
      data-testid={testId}
      className="chat-markdown mt-6 text-sm leading-7 text-card-foreground"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
