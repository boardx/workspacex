import { z } from "zod";

const ReportMetaEvent = z.object({
  type: z.literal("meta"),
  title: z.string().trim().min(1),
  executiveSummary: z.string().trim().min(1),
}).strict();

const ReportSectionEvent = z.object({
  type: z.literal("section"),
  markdown: z.string().trim().min(1),
}).strict();

const ReportFindingEvent = z.object({
  type: z.literal("finding"),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  expertId: z.string().trim().min(1),
  questionId: z.string().trim().min(1),
}).strict();

export const DigitalReportStreamEvent = z.discriminatedUnion("type", [
  ReportMetaEvent,
  ReportSectionEvent,
  ReportFindingEvent,
]);
export type DigitalReportStreamEvent = z.infer<typeof DigitalReportStreamEvent>;

/** Incremental NDJSON decoder. Only newline-terminated, fully validated events escape. */
export class DigitalReportNdjsonDecoder {
  private pending = "";

  push(delta: string): readonly DigitalReportStreamEvent[] {
    this.pending += delta;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    return lines.filter((line) => line.trim()).map((line) => DigitalReportStreamEvent.parse(JSON.parse(line)));
  }

  finish(): readonly DigitalReportStreamEvent[] {
    const tail = this.pending.trim();
    this.pending = "";
    return tail ? [DigitalReportStreamEvent.parse(JSON.parse(tail))] : [];
  }
}
