import { expect, it } from "vitest";
import { interviewReportFailureMessage } from "@/lib/interview-report-failure";
it("shows controlled report rejection reasons without exposing exception text", () => {
  expect(interviewReportFailureMessage("REPORT_ACTION_VALIDATION_REJECTED")).toBe("行动建议未通过校验，请重试。");
  expect(interviewReportFailureMessage("REPORT_QUALITY_REJECTED")).toBe("报告分析未通过校验，请重试。");
  expect(interviewReportFailureMessage("REPORT_GROUNDING_REJECTED")).toBe("报告引用未通过校验，请重试。");
  expect(interviewReportFailureMessage("secret provider text")).toBe("报告生成未完成，请重试。");
});
