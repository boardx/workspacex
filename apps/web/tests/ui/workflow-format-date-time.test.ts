import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/lib/workflow-run-meta";

describe("formatDateTime", () => {
  it("零填充 YYYY-MM-DD HH:mm", () => {
    expect(formatDateTime(new Date(2026, 0, 2, 3, 4).toISOString())).toBe("2026-01-02 03:04");
  });
  it("无效或空返回 null", () => {
    expect(formatDateTime("nope")).toBeNull();
    expect(formatDateTime(null)).toBeNull();
  });
});
