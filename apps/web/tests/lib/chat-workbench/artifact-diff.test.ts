import { describe,expect,it } from "vitest";
import { diffArtifactLines,isTextArtifact } from "@/lib/chat-workbench/agent-artifacts";
describe("artifact text comparisons",()=>{
  it("preserves common lines and identifies added/deleted content",()=>{
    expect(diffArtifactLines("a\nold\nc","a\nnew\nc").lines).toEqual([
      {kind:"same",text:"a"},{kind:"removed",text:"old"},{kind:"added",text:"new"},{kind:"same",text:"c"},
    ]);
  });
  it("normalizes line endings and explicitly reports bounded comparisons",()=>{
    expect(diffArtifactLines("a\r\nb","a\nb").lines.every(line=>line.kind==="same")).toBe(true);
    expect(diffArtifactLines("a\nb\nc","a\nb\nd",2).truncated).toBe(true);
  });
  it("does not present office or PDF binaries as text changes",()=>{
    expect(isTextArtifact("report.PDF")).toBe(false);expect(isTextArtifact("report.docx")).toBe(false);
    expect(isTextArtifact("report.md")).toBe(true);
  });
});
