import { describe, expect, it } from "vitest";
import { validateSessionPath } from "../src/session/paths.js";

describe("session virtual path boundary", () => {
  it("allows workspace and read-only skill references", () => {
    expect(validateSessionPath("/workspace/报告.xlsx", true)).toBe("/workspace/报告.xlsx");
    expect(validateSessionPath("/skills/research/SKILL.md")).toBe("/skills/research/SKILL.md");
  });
  it.each(["/etc/passwd", "/run/sandbox/skill-sandbox.sock", "/workspace-other/a",
    "/workspace/../skills/a", "/workspace/./a", "/workspace//a", "workspace/a",
    "/workspace/a\\b", "/workspace/a\0b"])("rejects ambiguous or escaping path %s", (path) => {
    expect(() => validateSessionPath(path)).toThrow("INVALID_SESSION_PATH");
  });
  it("does not permit changing mounted skills", () => {
    expect(() => validateSessionPath("/skills/a/SKILL.md", true)).toThrow("SESSION_PATH_READ_ONLY");
    expect(() => validateSessionPath("/skills", true)).toThrow("SESSION_PATH_READ_ONLY");
  });
});
