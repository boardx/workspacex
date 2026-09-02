import {
  DigitalReportStreamEvent,
  type DigitalReportStreamEvent as DigitalReportStreamEventValue,
} from "@repo/contracts/interview";

export type ParsedDigitalReportStreamEvent = DigitalReportStreamEventValue;

/** Incremental NDJSON decoder. Only newline-terminated, fully validated events escape. */
export class DigitalReportNdjsonDecoder {
  private pending = "";

  push(delta: string): readonly ParsedDigitalReportStreamEvent[] {
    this.pending += delta;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    return lines.filter((line) => line.trim()).map((line) => DigitalReportStreamEvent.parse(JSON.parse(line)));
  }

  finish(): readonly ParsedDigitalReportStreamEvent[] {
    const tail = this.pending.trim();
    this.pending = "";
    return tail ? [DigitalReportStreamEvent.parse(JSON.parse(tail))] : [];
  }
}
