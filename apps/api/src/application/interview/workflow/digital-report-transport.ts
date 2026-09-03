import { interview as C } from "@repo/contracts";
import type { z } from "zod";

type Workflow = z.infer<typeof C.DigitalInterviewWorkflowView>;
type Report = z.infer<typeof C.DigitalInterviewReport>;
type Generation = z.infer<typeof C.DigitalInterviewReportGeneration>;
type TransportEvent = z.infer<typeof C.DigitalReportTransportEvent>;

type ReportProjection = Pick<
  Generation,
  "reportId" | "title" | "executiveSummary" | "markdown" | "findings" | "updatedAt" | "errorCode"
> & { readonly status: Generation["status"] | "completed" };

function projectionFromReport(report: Report): ReportProjection {
  return {
    reportId: report.reportId,
    title: report.title,
    executiveSummary: report.executiveSummary,
    markdown: report.markdown,
    findings: report.findings,
    updatedAt: report.generatedAt,
    status: "completed",
    errorCode: null,
  };
}

function assertAppendOnly<T>(previous: readonly T[], current: readonly T[], label: string): void {
  if (current.length < previous.length) throw new Error(`${label} is not append-only`);
  for (let index = 0; index < previous.length; index += 1) {
    if (JSON.stringify(previous[index]) !== JSON.stringify(current[index])) {
      throw new Error(`${label} is not append-only`);
    }
  }
}

/** Stateful, connection-local projection from durable workflow snapshots to compact deltas. */
export class DigitalReportTransportProjector {
  private previous: ReportProjection | null = null;
  private seq = 0;

  project(workflow: Workflow): readonly TransportEvent[] {
    const generation = workflow.reportGeneration;
    const current = generation ?? (workflow.report ? projectionFromReport(workflow.report) : null);
    if (!current) return [];

    if (!this.previous && generation) {
      this.previous = generation;
      return [C.DigitalReportTransportEvent.parse({ type: "snapshot", seq: 0, ...generation })];
    }

    const events: TransportEvent[] = [];
    if (this.previous) {
      if (!current.markdown.startsWith(this.previous.markdown)) throw new Error("report markdown is not append-only");
      assertAppendOnly(this.previous.findings, current.findings, "report findings");

      if (current.title && current.executiveSummary &&
          (current.title !== this.previous.title || current.executiveSummary !== this.previous.executiveSummary)) {
        events.push(C.DigitalReportTransportEvent.parse({
          type: "meta", seq: ++this.seq, title: current.title, executiveSummary: current.executiveSummary,
        }));
      }
      for (const finding of current.findings.slice(this.previous.findings.length)) {
        events.push(C.DigitalReportTransportEvent.parse({ type: "finding", seq: ++this.seq, finding }));
      }
      const markdown = current.markdown.slice(this.previous.markdown.length);
      if (markdown) events.push(C.DigitalReportTransportEvent.parse({ type: "section", seq: ++this.seq, markdown }));
    }
    this.previous = current;

    if (generation?.status === "failed") {
      events.push(this.error(generation.errorCode ?? "DEPENDENCY_UNAVAILABLE"));
    } else if (workflow.report) {
      events.push(C.DigitalReportTransportEvent.parse({
        type: "complete", seq: ++this.seq, reportId: workflow.report.reportId, version: workflow.version,
      }));
    }
    return events;
  }

  error(reasonCode: string): TransportEvent {
    return C.DigitalReportTransportEvent.parse({ type: "error", seq: ++this.seq, reasonCode });
  }
}
