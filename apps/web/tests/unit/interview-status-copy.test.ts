import { expect, it } from "vitest";
import { interview } from "@repo/contracts";
import { INTERVIEW_STATUS_LABEL, interviewStatusMessageKey } from "@/lib/interview-status-copy";
it("covers exactly the canonical workflow states", () => {
 expect(Object.keys(INTERVIEW_STATUS_LABEL).sort()).toEqual([...interview.DigitalInterviewStatus.options].sort());
 for (const status of interview.DigitalInterviewStatus.options) expect(interviewStatusMessageKey(status)).toBe(`itv.status.${status}`);
});
it("keeps archived copy and unknown status behavior", () => {
 expect(interviewStatusMessageKey("archived")).toBe("itv.live.archived");
 for (const status of ["unknown", "", "__proto__", "constructor"]) expect(interviewStatusMessageKey(status)).toBeNull();
});
